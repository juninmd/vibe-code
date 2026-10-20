import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessModel } from "@vibe-code/shared";
import { resolveOpencodeBinary } from "../agents/engines/opencode";
import type { EngineRegistry } from "../agents/registry";
import { killProcessTree } from "../utils/process-tree";

export async function harnessCli(argv: string[], cwd?: string): Promise<string> {
  const process = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => void killProcessTree(process.pid), 20_000);
  try {
    const [out, , code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (code !== 0) throw new Error("Não foi possível consultar o harness instalado.");
    return out;
  } finally {
    clearTimeout(timer);
  }
}

export async function openCodeV2(): Promise<boolean> {
  const version = await harnessCli([resolveOpencodeBinary(), "--version"]);
  return /(?:^|\s)v?2\./.test(version);
}

export function parseOpenCodeCatalog(raw: string): HarnessModel[] {
  const response = JSON.parse(raw) as {
    data?: { providerID: string; id: string; name: string; variants?: { id: string }[] }[];
  };
  if (!Array.isArray(response.data)) throw new Error("Catálogo de modelos inválido.");
  return response.data.map((model) => ({
    id: `${model.providerID}/${model.id}`,
    name: model.name,
    efforts: (model.variants ?? []).map((variant) => variant.id),
  }));
}

export function parseClaudeCatalog(help: string, overrides: string[] = []): HarnessModel[] {
  const modelFlag =
    help
      .split(/\r?\n(?= {2}(?:--|-\w))/)
      .find((section) => section.trimStart().startsWith("--model ")) ?? "";
  const aliases = Array.from(modelFlag.matchAll(/['"]([\w.-]+)['"]/g), (match) => match[1]);
  const efforts =
    help
      .match(/--effort[^\n]*\n?\s*\(([^)]+)\)/)?.[1]
      .split(",")
      .map((value) => value.trim()) ?? [];
  return [...new Set([...aliases, ...overrides].filter(Boolean))].map((id) => ({
    id,
    name: id,
    efforts,
  }));
}

export async function harnessModels(
  name: string,
  registry: EngineRegistry
): Promise<HarnessModel[]> {
  if (name === "opencode") {
    if (await openCodeV2())
      return parseOpenCodeCatalog(
        await harnessCli([resolveOpencodeBinary(), "api", "get", "/api/model"])
      );
    // V1 verbose output consists of a model id followed by a JSON block.
    const verbose = await harnessCli([resolveOpencodeBinary(), "models", "--verbose"]);
    const models: HarnessModel[] = [];
    for (const match of verbose.matchAll(/^([^\s{}]+\/[^\s{}]+)\r?\n(\{[\s\S]*?^\})/gm)) {
      const model = JSON.parse(match[2]) as { name?: string; variants?: Record<string, unknown> };
      models.push({
        id: match[1],
        name: model.name ?? match[1],
        efforts: Object.keys(model.variants ?? {}),
      });
    }
    if (models.length) return models;
  }
  if (name === "claude-code") {
    const help = await harnessCli(["claude", "--help"]);
    return parseClaudeCatalog(
      help,
      (process.env.VIBE_CLAUDE_CODE_MODELS ?? "").split(",").map((value) => value.trim())
    );
  }
  return (await registry.listModels(name)).map((id) => ({ id, name: id, efforts: [] }));
}

export function modelReference(model: string, effort?: string) {
  const separator = model.indexOf("/");
  if (separator < 1) throw new Error("Selecione um modelo com provider/model.");
  return {
    providerID: model.slice(0, separator),
    id: model.slice(separator + 1).split("#")[0],
    ...(effort ? { variant: effort } : {}),
  };
}

export async function verifySessionWorkspace(cwd: string, location?: { directory?: string }) {
  if (!location?.directory) throw new Error("OpenCode não informou o workspace da sessão.");
  const [expected, actual] = await Promise.all([realpath(cwd), realpath(location.directory)]);
  const normalize = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);
  if (normalize(expected) !== normalize(actual))
    throw new Error("A sessão OpenCode registrada pertence a outro workspace.");
}

/** Persist the exact V2 conversation owned by this workspace; changing effort updates that session. */
export async function prepareOpenCodeSession(
  cwd: string,
  title: string,
  model?: string | null,
  effort?: string,
  run = harnessCli
): Promise<{ id: string; resumed: boolean }> {
  const marker = join(cwd, ".vibe-code", "opencode-session.json");
  let id: string | undefined;
  try {
    id = (JSON.parse(await readFile(marker, "utf8")) as { id?: string }).id;
  } catch {
    /* First session in this workspace. */
  }
  if (id && !/^[\w-]+$/.test(id)) throw new Error("Identificador da sessão OpenCode inválido.");
  const reference = model ? modelReference(model, effort) : undefined;
  const binary = resolveOpencodeBinary();
  if (id) {
    const session = JSON.parse(await run([binary, "api", "get", `/api/session/${id}`], cwd)) as {
      data?: { location?: { directory?: string } };
    };
    await verifySessionWorkspace(cwd, session.data?.location);
    if (reference)
      await run(
        [
          binary,
          "api",
          "post",
          `/api/session/${id}/model`,
          "--data",
          JSON.stringify({ model: reference }),
        ],
        cwd
      );
    return { id, resumed: true };
  }
  const response = JSON.parse(
    await run(
      [
        binary,
        "api",
        "post",
        "/api/session",
        "--data",
        JSON.stringify({
          title,
          location: { directory: cwd },
          ...(reference ? { model: reference } : {}),
        }),
      ],
      cwd
    )
  ) as { data?: { id?: string; location?: { directory?: string } } };
  if (!response.data?.id) throw new Error("OpenCode não retornou a sessão criada.");
  await verifySessionWorkspace(cwd, response.data.location);
  await mkdir(join(cwd, ".vibe-code"), { recursive: true });
  await writeFile(marker, JSON.stringify({ id: response.data.id }), "utf8");
  return { id: response.data.id, resumed: false };
}
