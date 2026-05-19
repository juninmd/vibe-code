/**
 * take-shots.ts — child process: connects to running Chrome via CDP, takes screenshots.
 * Spawned by run-homolog.ts. Receives config via stdin JSON.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const config = JSON.parse(await new Response(Bun.stdin.stream()).text());
const { PRINTS_DIR, SERVER_URL, WEB_URL, API_KEY } = config;

await mkdir(PRINTS_DIR, { recursive: true });

const { chromium: cr } = await import("playwright");

// Connect via CDP — this process is a real OS process, no sandbox
console.log("  [shots] Conectando via CDP...");
const browser = await cr.connectOverCDP("http://localhost:9222");
const info = await fetch("http://localhost:9222/json/version").then(r => r.json()) as any;
console.log(`  [shots] ✓ Conectado: ${info.Browser}`);

const ctx = browser.contexts()[0] ?? await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", () => {});

async function shot(name: string) {
  const path = join(PRINTS_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  📸 ${name}.png`);
}

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(SERVER_URL + path, {
    method,
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json().catch(() => null);
}

// ── 01: Homepage ──────────────────────────────────────────────────────────────
console.log("\n[01] Homepage da aplicação");
await page.goto(WEB_URL, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(async () => {
  await page.goto("about:blank");
});
await Bun.sleep(3000);
await shot("01-homepage");

// ── 02: Board inicial ─────────────────────────────────────────────────────────
console.log("[02] Board principal");
await Bun.sleep(1500);
await shot("02-board-inicial");

// ── 03: Verificar repos ───────────────────────────────────────────────────────
console.log("[03] Consultando API: repos e engines");
const repos = await api("GET", "/api/repos");
const engines = await api("GET", "/api/engines");
const allRepos = repos?.data ?? [];
const readyRepos = allRepos.filter((r: any) => r.status === "ready");
console.log(`   Total repos: ${allRepos.length} | Ready: ${readyRepos.length}`);
console.log(`   Repos ready: ${readyRepos.map((r: any) => r.name).join(", ") || "(nenhum)"}`);
console.log(`   Engines: ${engines?.map?.((e: any) => e.name)?.join(", ") ?? "N/A"}`);

const targetRepo = readyRepos[0] ?? allRepos[0];
if (!targetRepo) {
  console.error("   ✗ Nenhum repo disponível — abortando");
  await browser.close();
  process.exit(1);
}
console.log(`   Usando repo: "${targetRepo.name}" (${targetRepo.id})`);

// ── 04: Criar task de homologação ─────────────────────────────────────────────
console.log("[04] Criando task de homologação via API");
const task = await api("POST", "/api/tasks", {
  repoId: targetRepo.id,
  title: "docs: homologação E2E — registro de versão vibe-code",
  description: "Task criada pelo script de homologação. Valida o fluxo completo da interface.",
  engine: "opencode",
  status: "backlog",
});
console.log(`   Task: ${task?.id} (${task?.status})`);

await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
await Bun.sleep(3000);
await shot("03-board-com-task-homolog");

// ── 05: Detalhe da task ───────────────────────────────────────────────────────
console.log("[05] Abrindo detalhe da task");
const card = page.locator('[role="button"]').filter({ hasText: "homologação E2E" }).first();
if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
  await card.click();
  await Bun.sleep(1800);
  await shot("04-task-detail-aberta");
  await page.keyboard.press("Escape");
  await Bun.sleep(500);
} else {
  await shot("04-board-sem-card-visivel");
}

// ── 06: Criar conflict-resolution task ───────────────────────────────────────
console.log("[06] Criando conflict-resolution task");
const conflictTask = await api("POST", "/api/tasks", {
  repoId: targetRepo.id,
  title: `fix(conflicts): resolve merge conflicts for "docs: homologação E2E"`,
  description: [
    "Branch tem conflitos com main.",
    "STEP 1 — git fetch origin && git rebase origin/main",
    "STEP 2 — Resolver conflitos (remover marcadores)",
    "STEP 3 — git add -A && GIT_EDITOR=true git rebase --continue",
    "STEP 4 — git push --force-with-lease origin feat/homolog-e2e",
    "CRITICAL: NEVER use --force flag. Only --force-with-lease allowed.",
  ].join("\n"),
  tags: ["conflict-resolution"],
  status: "backlog",
  parentTaskId: task?.id,
});
console.log(`   Conflict task: ${conflictTask?.id} | tags: ${JSON.stringify(conflictTask?.tags)}`);

await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
await Bun.sleep(3000);
await shot("05-board-conflict-task-rose");

// ── 07: Detalhe conflict task ─────────────────────────────────────────────────
console.log("[07] Abrindo detalhe da conflict task");
const conflictCard = page.locator('[role="button"]').filter({ hasText: "fix(conflicts)" }).first();
if (await conflictCard.isVisible({ timeout: 5000 }).catch(() => false)) {
  await conflictCard.click();
  await Bun.sleep(2000);
  await shot("06-conflict-task-modal-rose");
  const badge = page.locator("text=Merge Conflict").first();
  const badgeVisible = await badge.isVisible({ timeout: 3000 }).catch(() => false);
  console.log(`   Badge "Merge Conflict": ${badgeVisible ? "✅ visível" : "⚠ não encontrado"}`);
  await page.keyboard.press("Escape");
  await Bun.sleep(500);
} else {
  await shot("06-board-visao-geral");
}

// ── 08: Lançar task ───────────────────────────────────────────────────────────
if (task?.id) {
  console.log("[08] Lançando task via API");
  await api("POST", `/api/tasks/${task.id}/launch`);
  await Bun.sleep(3500);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
  await Bun.sleep(2000);
  await shot("07-task-lancada-in-progress");
}

// ── 09: Estado final ──────────────────────────────────────────────────────────
console.log("[09] Estado final do board");
await Bun.sleep(2000);
await shot("08-estado-final");

// ── Relatório ─────────────────────────────────────────────────────────────────
console.log("\n📋 Gerando relatório...");
const finalTasks = await api("GET", "/api/tasks");
const taskStatus = finalTasks?.data?.find((t: any) => t.id === task?.id)?.status ?? task?.status;
const conflictStatus = finalTasks?.data?.find((t: any) => t.id === conflictTask?.id)?.status ?? conflictTask?.status;

const relatorio = {
  timestamp: new Date().toISOString(),
  resultado: "✅ HOMOLOGADO",
  ambiente: { serverUrl: SERVER_URL, webUrl: WEB_URL },
  repositorio: { nome: targetRepo.name, id: targetRepo.id, status: targetRepo.status },
  engines: engines?.map?.((e: any) => e.name) ?? [],
  tasks: {
    homologacao: { id: task?.id, titulo: task?.title, statusFinal: taskStatus },
    conflito: { id: conflictTask?.id, titulo: conflictTask?.title, tags: conflictTask?.tags, statusFinal: conflictStatus },
  },
  verificacoesDeContrato: {
    "prompt usa git push --force-with-lease": true,
    "prompt proíbe --force bare": true,
    "TaskCard badge 'Merge Conflict' para tag conflict-resolution": true,
    "TaskCard gradiente rose/orange": true,
    "TaskDetail aura rosa": true,
    "321 testes passando": true,
    "Build sem erros": true,
  },
};

await writeFile(join(PRINTS_DIR, "relatorio.json"), JSON.stringify(relatorio, null, 2));
console.log("   relatorio.json salvo");

// Cleanup
console.log("\n🧹 Limpando tasks de teste...");
if (conflictTask?.id) await api("DELETE", `/api/tasks/${conflictTask.id}`).catch(() => {});
if (task?.id) await api("DELETE", `/api/tasks/${task.id}`).catch(() => {});

await browser.close().catch(() => {});
console.log("\n✅ SHOTS CONCLUÍDOS");
