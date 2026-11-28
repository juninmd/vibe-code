/**
 * Evidence for a pull request body: the agent's `.vibe-code/evidence/EVIDENCE.md`
 * (commands it ran and their real output) and the Playwright MCP screenshots.
 * Screenshots go to `refs/vibe-code/evidence/<branch>`, an orphan commit outside
 * the PR diff, and are embedded by commit sha.
 */
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GitService } from "../../git/git-service";
import { EVIDENCE_DIR } from "../../mcp/default-servers";
import { redactSecrets } from "../../utils/secret-redactor";
import { buildAssetBlobUrl } from "./executor";

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const MAX_IMAGES = 20;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_NOTES = 6_000;

export interface EvidenceFile {
  name: string;
  path: string;
}

async function listImages(dir: string): Promise<EvidenceFile[]> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => IMAGE.test(n));
  const files: EvidenceFile[] = [];
  for (const name of names.sort()) {
    const path = join(dir, name);
    // lstat: a symlink named *.png must not publish whatever it points at.
    const info = await lstat(path).catch(() => null);
    if (info?.isFile() && info.size <= MAX_IMAGE_BYTES) files.push({ name, path });
    if (files.length === MAX_IMAGES) break;
  }
  return files;
}

function imageUrl(repoUrl: string, sha: string, name: string): string {
  const url = buildAssetBlobUrl(repoUrl, sha, name);
  return url.includes("github.com") ? `${url}?raw=true` : url;
}

/** Markdown "Evidence" section; says so when the session captured none. */
export async function prEvidenceSection(
  wtPath: string,
  repoUrl: string,
  branch: string,
  git: Pick<GitService, "publishEvidence">,
  log: (line: string) => void = () => {}
): Promise<string> {
  const dir = join(wtPath, EVIDENCE_DIR);
  // The section brings its own heading; drop the agent's top-level "# Evidence".
  const notesPath = join(dir, "EVIDENCE.md");
  const notesFile = (await lstat(notesPath).catch(() => null))?.isFile();
  const notes = redactSecrets(
    (notesFile ? await readFile(notesPath, "utf8").catch(() => "") : "")
      .trim()
      .replace(/^#{1,2}\s*evid[eê]nc\w*\s*\n+/i, "")
  );
  const images = await listImages(dir);
  if (!notes && images.length === 0)
    return "## Evidence\n\n_No evidence captured in this session._";

  const parts = ["## Evidence"];
  if (notes)
    parts.push(notes.length > MAX_NOTES ? `${notes.slice(0, MAX_NOTES)}\n\n_(truncated)_` : notes);
  if (images.length > 0) {
    try {
      const sha = await git.publishEvidence(wtPath, `refs/vibe-code/evidence/${branch}`, images);
      parts.push(images.map((f) => `![${f.name}](${imageUrl(repoUrl, sha, f.name)})`).join("\n\n"));
      log(`Evidence: ${images.length} screenshot(s) published.`);
    } catch (err) {
      log(`Evidence: screenshots not published (${(err as Error).message.split("\n")[0]}).`);
      parts.push(`Screenshots captured but not published: ${images.map((f) => f.name).join(", ")}`);
    }
  }
  return parts.join("\n\n");
}
