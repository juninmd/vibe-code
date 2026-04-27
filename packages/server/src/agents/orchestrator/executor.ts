import { access, appendFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRun, SkillPayload, Task } from "@vibe-code/shared";
import type { Db } from "../../db";
import type { GitService } from "../../git/git-service";
import type { SkillsLoader } from "../../skills/loader";
import type { BroadcastHub } from "../../ws/broadcast";
import type { AgentEngine } from "../engine";
import { deleteVirtualKey, generateVirtualKey, getLiteLLMBaseUrl } from "../litellm-client";
import { runBaselineCheck } from "./baseline-check";
import { runPostRunEvaluator } from "./evaluator";
import { handleAgentEvent } from "./event-handler";
import { writeHarnessContext } from "./harness-context";
import { runPlannerIfNeeded } from "./planner";
import { buildContextAsync } from "./prompt";
import { REVIEW_ENABLED, REVIEW_STRICT, runReviewPipeline } from "./review";
import { logAgentFinish, logAgentStart, logOrchestratorEvent } from "./terminal-logger";
import { verifyWorktree } from "./verify";

const REVIEW_AUTO_APPLY = process.env.VIBE_CODE_REVIEW_AUTO_APPLY !== "false";
const DOCS_AUTO_APPLY = process.env.VIBE_CODE_DOCS_AUTO_APPLY !== "false";
const FINAL_VALIDATOR_MAX_ATTEMPTS =
  Number(process.env.VIBE_CODE_FINAL_VALIDATOR_MAX_ATTEMPTS) > 0
    ? Number(process.env.VIBE_CODE_FINAL_VALIDATOR_MAX_ATTEMPTS)
    : 3;

function taskSlug(task: Task): string {
  return task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

function docsRelativePath(task: Task): string {
  const slug = taskSlug(task);
  return `docs/tasks/${slug || "task"}.md`;
}

function normalizeAsciiText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E\n\r\t]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function buildReviewAutofixPrompt(task: Task, findings: string[]): string {
  const formattedFindings = findings
    .slice(0, 30)
    .map((f, i) => `${i + 1}. ${f}`)
    .join("\n");
  return [
    "You are continuing an existing coding task after review feedback.",
    "Apply the actionable review suggestions below directly in the repository.",
    "",
    "Rules:",
    "- Do NOT use `pgrep`; use `ps|grep` alternatives when needed.",
    "- If a tool call is denied by policy, switch approach and continue (do not retry the same denied tool).",
    "- Implement concrete fixes in code and tests when relevant.",
    "- If changed logic has no tests, add automated tests.",
    "- If the task creates a new frontend project, use React + Vite (prefer TypeScript) instead of plain HTML/JS.",
    "- Do NOT rewrite unrelated files.",
    "- Keep fixes minimal and aligned with the existing stack.",
    "- If a suggestion is not applicable, skip it and continue with the rest.",
    "- Do not open PRs or perform git push; only change files.",
    "",
    "Task context:",
    `Title: ${task.title}`,
    task.description ? `Description: ${task.description}` : "",
    "",
    "Actionable review findings:",
    formattedFindings,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDocsAutofixPrompt(task: Task, findings: string[]): string {
  const docsFile = docsRelativePath(task);
  const screenshotFile = `docs/assets/${taskSlug(task) || "task"}.png`;
  const formattedFindings = findings
    .slice(0, 30)
    .map((f, i) => `${i + 1}. ${f}`)
    .join("\n");
  return [
    "You are the documentation finisher for this task.",
    "Implement documentation updates directly in the repository.",
    "",
    "Required actions:",
    `1) Create or update ${docsFile} with detailed content.`,
    "2) Include clear sections: Contexto, Funcionalidades entregues, Decisões de arquitetura, Impactos e riscos, Como validar, Rollback, Próximos passos.",
    "3) If behavior/contracts/workflow changed, update README.md and/or AGENTS.md accordingly.",
    "4) Ensure docs explicitly mention testing strategy and commands used.",
    "5) For frontend tasks ONLY: if the app is already running and you can discover its URL, try to capture the UI. This is OPTIONAL — skip silently if the app is not running or the tool is unavailable.",
    "6) Do NOT start or build the app just to take a screenshot. Do NOT capture the Vibe-Code dashboard unless the task explicitly modifies the Vibe-Code UI itself.",
    `7) If a screenshot was taken, save it to ${screenshotFile} and reference it in docs with a relative markdown image link. Otherwise omit any image reference.`,
    "8) Add an 'Evidencias visuais' section in docs: include the target app URL if found, and either the screenshot path or a one-line note explaining why capture was skipped.",
    "9) If frontend was created from scratch, document why React + Vite was used and project structure.",
    "10) Keep text factual and based only on current repository changes.",
    "11) Do not push or open PR; only modify files.",
    "12) Environment policy: avoid `run_shell_command` and `pgrep`; if denied by policy, use allowed alternatives and proceed.",
    "",
    "Task context:",
    `Title: ${task.title}`,
    task.description ? `Description: ${task.description}` : "",
    "",
    "Documentation review findings:",
    formattedFindings ||
      "(no explicit findings; still create detailed docs file based on current diff)",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFinalValidatorPrompt(task: Task): string {
  return [
    "You are the final validation agent for this task.",
    "Run a full quality gate using this repository's own CLI and conventions.",
    "",
    "Mandatory flow:",
    "1) Discover the project-native commands from scripts/Makefile/Taskfile/justfile/README and other local docs.",
    "2) Run lint, test, and build (all three are required).",
    "3) If any command fails, fix the code and tests, then re-run lint/test/build.",
    "4) Repeat until lint, test, and build all pass in this worktree.",
    "5) Do not push and do not open PR/MR; only modify repository files.",
    "",
    "Output requirements:",
    "- Log the exact lint/test/build commands you executed.",
    "- If a required command does not exist, add a minimal project-native command and use it.",
    "- Keep changes scoped to this task only.",
    "",
    "Environment policy:",
    "- Do NOT use `pgrep`; use alternatives (`ps`, `grep`, `lsof`, `/proc`).",
    "- If a tool call is denied by policy, switch strategy and continue.",
    "",
    "Task context:",
    `Title: ${task.title}`,
    task.description ? `Description: ${task.description}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Appends to .gitignore in the worktree, creating it if needed. */
async function ensureGitignoreEntry(wtPath: string, entry: string): Promise<void> {
  // Use .git/info/exclude instead of .gitignore to avoid generating tracked file changes.
  const gitignorePath = join(wtPath, ".git", "info", "exclude");
  try {
    const content = await readFile(gitignorePath, "utf8").catch(() => "");
    const lines = content.split("\n").map((l) => l.trim());
    if (!lines.includes(entry)) {
      await appendFile(gitignorePath, `\n${entry}\n`, "utf8");
    }
  } catch {
    // Best effort — don't block execution if .gitignore write fails
  }
}

/** Extract persona name from a review finding line like "[Frontend Review] WARNING: ..." */
function extractPersona(finding: string): string {
  const match = finding.match(/^\[([^\]]+)\]/);
  if (match) return match[1].toLowerCase().replace(/\s+review$/i, "");
  return "unknown";
}

function normalizeRepoWebUrl(repoUrl: string): string {
  const sshMatch = repoUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2].replace(/\.git$/, "")}`;
  }

  try {
    const u = new URL(repoUrl);
    u.pathname = u.pathname.replace(/\.git$/, "").replace(/\/$/, "");
    return `${u.origin}${u.pathname}`;
  } catch {
    return repoUrl.replace(/\.git$/, "").replace(/\/$/, "");
  }
}

function extractDocsAssetPath(rawPath: string): string | null {
  const withoutQuery = rawPath.split(/[?#]/)[0].trim();
  const normalized = withoutQuery.replace(/^\.?\//, "");
  if (normalized.startsWith("docs/assets/")) return normalized;

  const idx = normalized.indexOf("docs/assets/");
  if (idx >= 0) return normalized.slice(idx);

  return null;
}

function buildAssetBlobUrl(repoUrl: string, branch: string, assetPath: string): string {
  const base = normalizeRepoWebUrl(repoUrl);
  const encodedBranch = encodeURIComponent(branch).replace(/%2F/g, "/");
  const encodedAssetPath = assetPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  if (base.includes("github.com")) {
    return `${base}/blob/${encodedBranch}/${encodedAssetPath}`;
  }

  if (base.includes("gitlab")) {
    return `${base}/-/blob/${encodedBranch}/${encodedAssetPath}?ref_type=heads`;
  }

  return `${base}/-/blob/${encodedBranch}/${encodedAssetPath}`;
}

function rewriteDocsAssetLinks(body: string, repoUrl: string, branch: string): string {
  return body.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt, target) => {
    const assetPath = extractDocsAssetPath(target);
    if (!assetPath) return full;
    const blobUrl = buildAssetBlobUrl(repoUrl, branch, assetPath);
    return `![${alt}](${blobUrl})`;
  });
}

/** Builds PR body using only the docs generated in the docs step. */
async function buildPRBody(
  task: Task,
  wtPath: string,
  repoUrl: string,
  branch: string
): Promise<string> {
  const docsRel = docsRelativePath(task);
  const docsFile = join(wtPath, docsRel);

  // Use only docs-generated content for MR description.
  try {
    const docsText = (await readFile(docsFile, "utf8")).trim();
    if (docsText) {
      const clipped =
        docsText.length > 12000 ? `${docsText.slice(0, 12000)}\n\n...[truncated]` : docsText;
      return normalizeAsciiText(rewriteDocsAssetLinks(clipped, repoUrl, branch));
    }
  } catch {
    // Optional docs file
  }

  // Fallback when docs file is missing or empty.
  return normalizeAsciiText(task.description?.trim() || `Task: ${task.title}`);
}

export async function runWorkspaceScripts(
  type: "setup" | "teardown",
  wtPath: string,
  repoName: string,
  sysLog: (msg: string) => void
): Promise<void> {
  let configPath = join(wtPath, ".superset", "config.json");
  let configExists = false;

  try {
    await access(configPath);
    configExists = true;
  } catch {
    configPath = join(wtPath, ".vibe-code", "config.json");
    try {
      await access(configPath);
      configExists = true;
    } catch {
      return; // No config found
    }
  }

  if (!configExists) return;

  try {
    const configContent = await readFile(configPath, "utf8");
    const config = JSON.parse(configContent);
    const scripts = config[type];

    if (Array.isArray(scripts) && scripts.length > 0) {
      sysLog(`Running ${type} scripts from ${configPath}...`);
      const env = {
        ...process.env,
        SUPERSET_WORKSPACE_NAME: repoName,
        SUPERSET_ROOT_PATH: wtPath,
        VIBE_CODE_WORKSPACE_NAME: repoName,
        VIBE_CODE_ROOT_PATH: wtPath,
      };

      for (const script of scripts) {
        if (typeof script !== "string") continue;
        sysLog(`> ${script}`);

        const proc = Bun.spawn(["sh", "-c", script], {
          cwd: wtPath,
          env,
          stdout: "pipe",
          stderr: "pipe",
        });

        const stdoutText = await new Response(proc.stdout).text();
        const stderrText = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        if (stdoutText.trim()) sysLog(stdoutText.trim());
        if (stderrText.trim()) sysLog(stderrText.trim());

        if (exitCode !== 0) {
          sysLog(`${type} script '${script}' failed with exit code ${exitCode}`);
        }
      }
      sysLog(`${type} scripts completed.`);
    }
  } catch (err: any) {
    sysLog(`Failed to execute ${type} scripts: ${err.message}`);
  }
}

export async function executeAgent(
  task: Task,
  run: AgentRun,
  engine: AgentEngine,
  repo: any,
  abort: AbortController,
  db: Db,
  git: GitService,
  hub: BroadcastHub,
  sysLog: (content: string) => void,
  onFinish: () => void,
  model?: string,
  skillsLoader?: SkillsLoader
): Promise<void> {
  const barePath = repo.localPath ?? (await git.getBarePath(repo.name));
  const slugTitle = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  let branch = `vibe-code/${run.id.slice(0, 8)}/${slugTitle}`;
  let resumeExistingBranch = false;

  const TIMEOUT_MS = Number(process.env.VIBE_CODE_AGENT_TIMEOUT_MS) || 2 * 60 * 60 * 1000;
  const INACTIVITY_MS = Number(process.env.VIBE_CODE_INACTIVITY_MS) || 10 * 60 * 1000;
  let timedOut = false;
  let lastActivity = Date.now();

  const effectiveModel = model ?? "opencode/minimax-m2.5-free";
  logAgentStart(task.id, engine.name, effectiveModel, repo.name);

  const timeoutId = setTimeout(() => {
    timedOut = true;
    logOrchestratorEvent(
      `Task ${task.id.slice(0, 8)} timed out after ${TIMEOUT_MS / 60000}m`,
      "warn"
    );
    abort.abort();
  }, TIMEOUT_MS);

  const monitorId = setInterval(() => {
    const inactiveSecs = Math.round((Date.now() - lastActivity) / 1000);
    if (Date.now() - lastActivity > INACTIVITY_MS) {
      timedOut = true;
      logOrchestratorEvent(
        `Task ${task.id.slice(0, 8)} inactive for ${inactiveSecs}s — aborting`,
        "warn"
      );
      abort.abort();
    }
  }, 30_000);

  let wtPath: string | undefined;
  let keepWorkspaceForRetry = false;
  let litellmTokenId: string | undefined;
  let skillPayload: SkillPayload | undefined;
  let validatorAttempts = 0;
  let createdContextFiles: string[] = [];
  let reviewBlockerCount = 0;
  let reviewWarningCount = 0;
  let prCreated = false;
  let runStartTime = Date.now();
  let capturedCostStats: object | null = null;
  try {
    let reusableWorkspacePath: string | null = null;

    if (task.status === "failed" && task.branchName) {
      const exists = await git.branchExists(barePath, task.branchName);
      if (exists) {
        branch = task.branchName;
        resumeExistingBranch = true;

        const previousRun = db.runs
          .listByTask(task.id)
          .find((r) => r.id !== run.id && r.status === "failed" && !!r.worktreePath);

        if (previousRun?.worktreePath) {
          try {
            await access(previousRun.worktreePath);
            reusableWorkspacePath = previousRun.worktreePath;
          } catch {
            reusableWorkspacePath = null;
          }
        }
      }
    }

    db.runs.updateStatus(run.id, "running", { started_at: new Date().toISOString() });
    db.runs.updateStateSnapshot(run.id, "setup");
    sysLog("Setting up workspace...");

    if (reusableWorkspacePath) {
      wtPath = reusableWorkspacePath;
      await git.fetchRepo(barePath);
      sysLog(`Workspace reused at ${wtPath}`);
    } else {
      wtPath = await git.createWorktree(
        barePath,
        branch,
        repo.name,
        run.id,
        task.baseBranch || repo.defaultBranch,
        !resumeExistingBranch
      );
      sysLog(`Workspace ready at ${wtPath}`);
    }

    db.runs.updateStatus(run.id, "running", { worktree_path: wtPath });
    db.runs.updateStateSnapshot(run.id, "worktree_ready");

    // Run setup scripts if available
    await runWorkspaceScripts("setup", wtPath, repo.name, sysLog);

    // M4: Baseline verification — detect pre-existing breakage before the agent starts
    {
      const baseline = await runBaselineCheck(wtPath);
      if (baseline.skipped) {
        sysLog(`Baseline check: ${baseline.details}`);
      } else if (baseline.passed) {
        sysLog("Baseline check: passed ✓");
      } else {
        sysLog("Baseline check: FAILED — pre-existing issues detected (agent will be informed)");
        sysLog(baseline.details);
      }
    }

    // Ensure opencode.json won't pollute git history
    await ensureGitignoreEntry(wtPath, "opencode.json");

    // Generate a per-run virtual key in LiteLLM when enabled.
    // When disabled, engines use native API keys from the environment.
    const litellmEnabled = db.settings.get("litellm_enabled") !== "false";
    let litellmKey: string | undefined;
    let litellmBaseUrl: string | undefined;

    if (litellmEnabled) {
      try {
        const baseUrl = getLiteLLMBaseUrl(db.settings.get("litellm_base_url"));
        const vk = await generateVirtualKey(task.id, engine.name, baseUrl);
        litellmKey = vk.key;
        litellmBaseUrl = baseUrl;
        litellmTokenId = vk.tokenId;
        db.runs.updateLitellmTokenId(run.id, vk.tokenId);
        sysLog("LiteLLM proxy: enabled (virtual key generated)");
      } catch (err: any) {
        sysLog(`LiteLLM proxy: unavailable (${err.message}). Using native API keys.`);
      }
    } else {
      sysLog("LiteLLM proxy: disabled by setting. Using native API keys.");
    }

    // Native API keys stored via settings UI (used when LiteLLM is disabled).
    const nativeApiKeys = {
      gemini: db.settings.get("gemini_api_key") || undefined,
      anthropic: db.settings.get("anthropic_api_key") || undefined,
      openai: db.settings.get("openai_api_key") || undefined,
    };

    if (resumeExistingBranch) {
      sysLog(`Branch: ${branch} (resuming from previous failed run)`);
      sysLog(
        reusableWorkspacePath
          ? "Resume mode: continuing from preserved workspace + branch state."
          : "Resume mode: continuing from latest committed state on the same branch."
      );
    } else {
      sysLog(`Branch: ${branch}`);
    }

    let agentExitCode: number | null = null;
    runStartTime = Date.now();

    // M1.3: Build structured context with SkillPayload
    const findingsLoader = (repoId: string) =>
      db.findings.getRecentByRepo(repoId).map((f) => ({
        persona: f.persona,
        severity: f.severity,
        content: f.content,
      }));
    const contextResult = await buildContextAsync(
      task,
      wtPath,
      skillsLoader,
      task.repoId,
      findingsLoader
    );
    const prompt = contextResult.prompt;
    skillPayload = contextResult.skills;

    // M7.2: Record matched skills on the run (all 4 categories with prefix)
    const matchedSkillNames = [
      ...skillPayload.rules.map((r) => `rule:${r.name}`),
      ...skillPayload.skills.map((s) => `skill:${s.name}`),
      ...skillPayload.agents.map((a) => `agent:${a.name}`),
      ...(skillPayload.workflow ? [`workflow:${skillPayload.workflow.name}`] : []),
    ];
    db.runs.updateMatchedSkills(run.id, matchedSkillNames);

    // M3.6: Prepare engine-native context files (GEMINI.md, .claude/instructions.md, etc.)
    if (engine.prepareWorkdir) {
      try {
        createdContextFiles = await engine.prepareWorkdir(wtPath, skillPayload);
        for (const f of createdContextFiles) {
          const relative = f.startsWith(wtPath) ? f.slice(wtPath.length + 1) : f;
          await ensureGitignoreEntry(wtPath, relative);
        }
        if (createdContextFiles.length > 0) {
          sysLog(`Engine-native context: ${createdContextFiles.length} file(s) written`);
        }
      } catch (err: any) {
        sysLog(`Engine-native context: failed (${err.message}), continuing with prompt only`);
      }
    }

    // M2: Write harness context files (.vibe-code/context/PROGRESS.md + TASK.json)
    try {
      const harnessFiles = await writeHarnessContext(task, run, wtPath, db, git);
      for (const f of harnessFiles) {
        createdContextFiles.push(f);
        const relative = f.startsWith(wtPath) ? f.slice(wtPath.length + 1) : f;
        await ensureGitignoreEntry(wtPath, relative);
      }
      sysLog("Harness context written (.vibe-code/context/)");
    } catch (err: any) {
      sysLog(`Harness context write failed (${err.message}), continuing`);
    }

    // M5: Planner micro-step — expand short descriptions into a full spec
    let plannerSpec: string | null = null;
    if (litellmBaseUrl && litellmKey) {
      try {
        const plannerResult = await runPlannerIfNeeded(
          task.title,
          task.description ?? "",
          wtPath,
          litellmBaseUrl,
          litellmKey
        );
        if (plannerResult) {
          plannerSpec = plannerResult.spec;
          createdContextFiles.push(plannerResult.specPath);
          const relative = plannerResult.specPath.startsWith(wtPath)
            ? plannerResult.specPath.slice(wtPath.length + 1)
            : plannerResult.specPath;
          await ensureGitignoreEntry(wtPath, relative);
          db.tasks.updatePlannerSpec(task.id, plannerSpec);
          sysLog("Planner: spec expanded and written to .vibe-code/context/SPEC.md");
        }
      } catch (err: any) {
        sysLog(`Planner: failed (${err.message}), continuing with original description`);
      }
    }

    // Append context file reference to prompt so agents know where to look
    const specNote = plannerSpec
      ? "\n**Expanded spec is available in `.vibe-code/context/SPEC.md` — read it before starting.**"
      : "";
    const promptWithContext = `${prompt}\n\n---\n**Session context is available in \`.vibe-code/context/PROGRESS.md\` (human-readable) and \`.vibe-code/context/TASK.json\` (structured). Read them at the start if you need previous session notes or task metadata.**${specNote}`;

    db.runs.updateStateSnapshot(run.id, "agent_running");
    for await (const event of engine.execute(promptWithContext, wtPath, {
      runId: run.id,
      signal: abort.signal,
      model,
      litellmKey,
      litellmBaseUrl,
      nativeApiKeys,
      skills: skillPayload,
    })) {
      if (abort.signal.aborted) break;
      if (event.type === "complete") {
        agentExitCode = event.exitCode ?? 0;
        continue;
      }
      if (event.type === "cost" && event.costStats) {
        capturedCostStats = event.costStats;
        continue;
      }
      await handleAgentEvent(event, run.id, task.id, db, hub, () => {
        lastActivity = Date.now();
      });
    }

    if (abort.signal.aborted) throw new Error(timedOut ? "Agent timed out" : "Cancelled");

    if (agentExitCode !== null && agentExitCode !== 0) {
      throw new Error(`Agent exited with code ${agentExitCode}`);
    }

    sysLog(
      `Running final validator agent (lint/test/build), max attempts: ${FINAL_VALIDATOR_MAX_ATTEMPTS}...`
    );
    db.runs.updateStateSnapshot(run.id, "validating");
    let validatorPassed = false;
    let validatorExitCode: number | null = null;
    for (let attempt = 1; attempt <= FINAL_VALIDATOR_MAX_ATTEMPTS; attempt += 1) {
      validatorAttempts = attempt;
      validatorExitCode = null;
      const validatorPrompt = buildFinalValidatorPrompt(task);
      sysLog(`Final validator attempt ${attempt}/${FINAL_VALIDATOR_MAX_ATTEMPTS}...`);

      for await (const event of engine.execute(validatorPrompt, wtPath, {
        runId: run.id,
        signal: abort.signal,
        model,
        litellmKey,
        litellmBaseUrl,
        nativeApiKeys,
      })) {
        if (abort.signal.aborted) break;
        if (event.type === "complete") {
          validatorExitCode = event.exitCode ?? 0;
          continue;
        }
        await handleAgentEvent(event, run.id, task.id, db, hub, () => {
          lastActivity = Date.now();
        });
      }

      if (abort.signal.aborted) throw new Error(timedOut ? "Agent timed out" : "Cancelled");

      if (validatorExitCode === null || validatorExitCode === 0) {
        validatorPassed = true;
        sysLog(`Final validator passed on attempt ${attempt} ✓`);
        break;
      }

      if (attempt < FINAL_VALIDATOR_MAX_ATTEMPTS) {
        sysLog(
          `Final validator failed (exit ${validatorExitCode}). Retrying with updated context...`
        );
      }
    }

    if (!validatorPassed) {
      throw new Error(
        `Final validator failed after ${FINAL_VALIDATOR_MAX_ATTEMPTS} attempts (last exit ${validatorExitCode ?? "unknown"})`
      );
    }

    const baseBranch = task.baseBranch || repo.defaultBranch;

    // M6: Post-run evaluator — grade completeness against the task spec
    if (litellmBaseUrl && litellmKey) {
      try {
        db.runs.updateStateSnapshot(run.id, "evaluating");
        const grade = await runPostRunEvaluator(
          task.title,
          plannerSpec ?? task.description ?? "",
          wtPath,
          baseBranch,
          litellmBaseUrl,
          litellmKey
        );
        if (grade) {
          sysLog(
            `Evaluator grade: ${grade.score}/10 — ${grade.pass ? "PASS ✓" : "BELOW THRESHOLD ⚠"}`
          );
          sysLog(`Evaluator feedback: ${grade.feedback}`);

          if (!grade.pass) {
            // Send feedback to generator for one improvement loop
            sysLog("Evaluator: below threshold — running improvement loop...");
            const improvementPrompt = [
              "You are continuing an autonomous coding task after an evaluator found gaps.",
              "Apply the evaluator feedback below to improve the implementation.",
              "",
              "Rules:",
              "- Only address the specific gaps mentioned. Do NOT rewrite unrelated code.",
              "- If a suggested change is not applicable, skip it and continue.",
              "- Do not push or open PR. Only modify files.",
              "",
              `Task: ${task.title}`,
              task.description ? `Description: ${task.description}` : "",
              "",
              "Evaluator feedback:",
              grade.feedback,
            ]
              .filter(Boolean)
              .join("\n");

            for await (const event of engine.execute(improvementPrompt, wtPath, {
              runId: run.id,
              signal: abort.signal,
              model,
              litellmKey,
              litellmBaseUrl,
              nativeApiKeys,
            })) {
              if (abort.signal.aborted) break;
              if (event.type === "complete") continue;
              await handleAgentEvent(event, run.id, task.id, db, hub, () => {
                lastActivity = Date.now();
              });
            }
            if (abort.signal.aborted) throw new Error(timedOut ? "Agent timed out" : "Cancelled");

            if (await git.hasChanges(wtPath)) {
              await git.commitAll(wtPath, `fix: address evaluator feedback for ${task.title}`);
              sysLog("Evaluator improvement committed ✓");
            }
          }
        }
      } catch (err: any) {
        sysLog(`Evaluator: failed (${err.message}), continuing`);
      }
    }

    if (await git.hasChanges(wtPath)) {
      sysLog("Committing changes...");
      await git.commitAll(wtPath, `feat: ${task.title}`);
      sysLog("Changes committed ✓");
    }

    if (!(await git.hasCommitsAhead(wtPath, baseBranch))) throw new Error("Agent made no changes");

    await verifyWorktree(wtPath, sysLog);

    if (REVIEW_ENABLED) {
      sysLog("Running review pipeline...");
      db.runs.updateStateSnapshot(run.id, "reviewing");
      const reviewResult = await runReviewPipeline(
        task,
        run,
        wtPath,
        baseBranch,
        db,
        hub,
        (_rid, _tid, content) => sysLog(content),
        engine.name,
        model,
        litellmKey,
        litellmBaseUrl,
        nativeApiKeys
      );

      // M4.2: Persist review findings to DB
      reviewBlockerCount = reviewResult.blockers.length;
      reviewWarningCount = reviewResult.actionableFindings.length;
      for (const finding of reviewResult.blockers) {
        try {
          db.findings.create({
            runId: run.id,
            taskId: task.id,
            repoId: task.repoId,
            persona: extractPersona(finding),
            severity: "blocker",
            content: finding,
          });
        } catch {
          /* non-fatal */
        }
      }
      for (const finding of reviewResult.actionableFindings) {
        try {
          db.findings.create({
            runId: run.id,
            taskId: task.id,
            repoId: task.repoId,
            persona: extractPersona(finding),
            severity: "warning",
            content: finding,
          });
        } catch {
          /* non-fatal */
        }
      }
      for (const finding of reviewResult.docsFindings) {
        try {
          db.findings.create({
            runId: run.id,
            taskId: task.id,
            repoId: task.repoId,
            persona: "docs",
            severity: "info",
            content: finding,
          });
        } catch {
          /* non-fatal */
        }
      }

      if (REVIEW_AUTO_APPLY && reviewResult.actionableFindings.length > 0) {
        sysLog(
          `Applying ${reviewResult.actionableFindings.length} review suggestion(s) automatically...`
        );
        let autofixExitCode: number | null = null;
        const autofixPrompt = buildReviewAutofixPrompt(task, reviewResult.actionableFindings);
        for await (const event of engine.execute(autofixPrompt, wtPath, {
          runId: run.id,
          signal: abort.signal,
          model,
          litellmKey,
          litellmBaseUrl,
          nativeApiKeys,
        })) {
          if (abort.signal.aborted) break;
          if (event.type === "complete") {
            autofixExitCode = event.exitCode ?? 0;
            continue;
          }
          await handleAgentEvent(event, run.id, task.id, db, hub, () => {
            lastActivity = Date.now();
          });
        }

        if (abort.signal.aborted) throw new Error(timedOut ? "Agent timed out" : "Cancelled");

        if (autofixExitCode !== null && autofixExitCode !== 0) {
          throw new Error(`Review auto-apply exited with code ${autofixExitCode}`);
        }

        if (await git.hasChanges(wtPath)) {
          await git.commitAll(wtPath, `chore: apply review suggestions for ${task.title}`);
          sysLog("Review suggestions applied and committed ✓");
          await verifyWorktree(wtPath, sysLog);
        } else {
          sysLog("No file changes produced by review auto-apply.");
        }
      }

      if (DOCS_AUTO_APPLY) {
        sysLog("Running docs finishing step...");
        let docsExitCode: number | null = null;
        const docsPrompt = buildDocsAutofixPrompt(task, reviewResult.docsFindings);
        for await (const event of engine.execute(docsPrompt, wtPath, {
          runId: run.id,
          signal: abort.signal,
          model,
          litellmKey,
          litellmBaseUrl,
          nativeApiKeys,
        })) {
          if (abort.signal.aborted) break;
          if (event.type === "complete") {
            docsExitCode = event.exitCode ?? 0;
            continue;
          }
          await handleAgentEvent(event, run.id, task.id, db, hub, () => {
            lastActivity = Date.now();
          });
        }

        if (abort.signal.aborted) throw new Error(timedOut ? "Agent timed out" : "Cancelled");
        if (docsExitCode !== null && docsExitCode !== 0) {
          sysLog(
            `Docs step exited with code ${docsExitCode} — screenshot may be unavailable; continuing with available docs.`
          );
        }

        if (await git.hasChanges(wtPath)) {
          await git.commitAll(wtPath, `docs: add implementation notes for ${task.title}`);
          sysLog("Docs step applied and committed ✓");
          await verifyWorktree(wtPath, sysLog);
        } else {
          sysLog("Docs step finished with no file changes.");
        }
      }

      if (reviewResult.blockers.length > 0 && REVIEW_STRICT)
        throw new Error(`Review blockers: ${reviewResult.blockers.join(", ")}`);
    }

    db.tasks.updateField(task.id, "branch_name", branch);
    let prUrl: string | null = null;

    try {
      db.runs.updateStateSnapshot(run.id, "pr_creating");
      sysLog("Pushing branch to origin...");
      await git.push(wtPath, branch);
      sysLog("Branch pushed ✓");

      sysLog("Creating pull request...");
      const prBody = await buildPRBody(task, wtPath, repo.url, branch);
      prUrl = await git.createPR(wtPath, repo.url, branch, task.title, prBody, baseBranch);
      db.tasks.updateField(task.id, "pr_url", prUrl);
      prCreated = true;
      sysLog(`PR created: ${prUrl}`);
    } catch (err: any) {
      sysLog(`Push/PR skipped: ${err.message || String(err)}`);
    }

    const updatedTask = db.tasks.update(task.id, { status: "review" });
    const completedRun = db.runs.updateStatus(run.id, "completed", {
      finished_at: new Date().toISOString(),
      exit_code: 0,
    });
    if (capturedCostStats) {
      db.runs.updateCostStats(run.id, capturedCostStats);
    }
    // Flush any pending log batches before broadcasting terminal state
    hub.flushLogs(task.id);
    if (completedRun) hub.broadcastAll({ type: "run_updated", run: completedRun });
    if (updatedTask) hub.broadcastAll({ type: "task_updated", task: updatedTask });
    logAgentFinish(task.id, "completed", prUrl ? `PR: ${prUrl}` : "no PR");
  } catch (err: any) {
    const errMsg = err.message || String(err);
    const isCancelled = !timedOut && abort.signal.aborted;
    if (!isCancelled) {
      keepWorkspaceForRetry = true;
      if (wtPath) {
        sysLog(`Workspace preserved for retry at ${wtPath}`);
      }
      if (errMsg.includes("Verification failed")) {
        sysLog("Verification failed. MR creation blocked for this run.");
      }
      sysLog(`Failed: ${errMsg}`);
    }
    const failedRun = db.runs.updateStatus(run.id, isCancelled ? "cancelled" : "failed", {
      finished_at: new Date().toISOString(),
      error_message: isCancelled ? null : errMsg,
    });
    db.tasks.update(task.id, { status: isCancelled ? "backlog" : "failed" });
    // Flush pending logs before broadcasting terminal state
    hub.flushLogs(task.id);
    if (failedRun) hub.broadcastAll({ type: "run_updated", run: failedRun });
    const finalTask = db.tasks.getById(task.id);
    if (finalTask) hub.broadcastAll({ type: "task_updated", task: finalTask });
    logAgentFinish(task.id, isCancelled ? "cancelled" : "failed", errMsg);
  } finally {
    clearTimeout(timeoutId);
    clearInterval(monitorId);

    // M5.2: Record run metrics
    try {
      const finalRun = db.runs.getById(run.id);
      db.metrics.create({
        runId: run.id,
        taskId: task.id,
        repoId: task.repoId,
        engine: engine.name,
        model,
        matchedSkills: skillPayload?.skills.map((s) => s.name) ?? [],
        matchedRules: skillPayload?.rules.map((r) => r.name) ?? [],
        durationMs: Date.now() - runStartTime,
        validatorAttempts: validatorAttempts ?? 0,
        reviewBlockers: reviewBlockerCount,
        reviewWarnings: reviewWarningCount,
        finalStatus: finalRun?.status ?? "failed",
        prCreated,
      });
    } catch {
      /* metrics recording is non-fatal */
    }

    // M3.6: Cleanup engine-native context files
    for (const f of createdContextFiles) {
      try {
        await unlink(f);
      } catch {
        /* best effort */
      }
    }

    // Best-effort cleanup of the per-task LiteLLM virtual key.
    if (litellmTokenId) {
      const baseUrl = getLiteLLMBaseUrl(db.settings.get("litellm_base_url"));
      await deleteVirtualKey(litellmTokenId, baseUrl).catch(() => {});
    }

    if (wtPath && !keepWorkspaceForRetry) {
      // Run teardown scripts before removing worktree
      await runWorkspaceScripts("teardown", wtPath, repo.name, sysLog);

      try {
        await git.removeWorktree(barePath, wtPath);
      } catch {}
    }
    onFinish();
  }
}
