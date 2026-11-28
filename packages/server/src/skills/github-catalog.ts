import type { RemotePluginCatalog } from "@vibe-code/shared";

type TreeFile = { path: string; type: string; mode: string; size?: number };
type PinnedTree = { repo: string; ref: string; commit: string; files: TreeFile[] };
const MAX_FILE = 1024 * 1024;
const MAX_BUNDLE = 8 * MAX_FILE;

export function githubRepo(value: string): string {
  const repo = value
    .trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "");
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
    repo.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("Informe um repositório GitHub no formato owner/repo.");
  }
  return repo;
}

export function safeAssetPath(path: string): boolean {
  return (
    !!path &&
    !/[\\:]/.test(path) &&
    !Array.from(path).some((character) => character.charCodeAt(0) < 32) &&
    !path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          part.endsWith(".") ||
          part.endsWith(" ") ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      )
  );
}

/** GitHub data only; remote content is downloaded for review and is never executed. */
export class GitHubPluginCatalog {
  private readonly trees = new Map<string, { expires: number; tree: PinnedTree }>();
  constructor(private readonly token?: string) {}

  private async get(path: string, raw = false): Promise<Response> {
    const response = await fetch(`https://api.github.com/repos/${path}`, {
      headers: {
        Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "User-Agent": "vibe-code",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    if (!response.ok) {
      if (response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0")
        throw new Error(
          "Limite de consultas do GitHub atingido. Configure o acesso GitHub ou aguarde a renovação da cota e tente novamente."
        );
      throw new Error(
        `GitHub respondeu ${response.status}. Verifique o repositório e o acesso configurado.`
      );
    }
    return response;
  }

  private async tree(input: string, ref?: string) {
    const repo = githubRepo(input);
    let selected = ref?.trim();
    const pinned = selected && /^[a-f0-9]{40}$/i.test(selected);
    const cached = pinned ? this.trees.get(`${repo}@${selected}`) : undefined;
    if (cached && cached.expires > Date.now()) return cached.tree;
    if (!selected) {
      const metadata = (await (await this.get(repo)).json()) as { default_branch: string };
      selected = metadata.default_branch;
    }
    if (
      !selected ||
      selected.length > 200 ||
      Array.from(selected).some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error("Referência Git inválida.");
    const revision = pinned
      ? { sha: selected }
      : ((await (await this.get(`${repo}/commits/${encodeURIComponent(selected)}`)).json()) as {
          sha: string;
        });
    const tree = (await (
      await this.get(`${repo}/git/trees/${revision.sha}?recursive=1`)
    ).json()) as { truncated?: boolean; tree: TreeFile[] };
    if (tree.truncated)
      throw new Error("O catálogo do GitHub está truncado. Use um repositório menor.");
    const files = tree.tree.filter(
      (file) => file.type === "blob" && file.mode !== "120000" && safeAssetPath(file.path)
    );
    const result = { repo, ref: selected, commit: revision.sha, files };
    // Bound retained metadata; branch discovery always resolves a fresh revision.
    if (this.trees.size >= 8) this.trees.delete(this.trees.keys().next().value as string);
    this.trees.set(`${repo}@${revision.sha}`, { expires: Date.now() + 300_000, tree: result });
    return result;
  }

  async discover(input: string, ref?: string): Promise<RemotePluginCatalog> {
    const { files, ...source } = await this.tree(input, ref);
    const assets = files
      .filter((file) => /(^|\/)SKILL\.md$|\.(agent|instructions|prompt)\.md$/.test(file.path))
      .map((file) => {
        const parent = file.path.slice(0, file.path.lastIndexOf("/") + 1);
        const skill = file.path.endsWith("SKILL.md");
        return {
          name: skill
            ? (parent.split("/").filter(Boolean).pop() ?? source.repo.split("/")[1])
            : (file.path.split("/").pop()?.replace(/\.md$/, "") ?? file.path),
          path: file.path,
          category: skill
            ? ("skill" as const)
            : file.path.endsWith(".agent.md")
              ? ("agent" as const)
              : file.path.endsWith(".prompt.md")
                ? ("workflow" as const)
                : ("rule" as const),
          files: skill ? files.filter((entry) => entry.path.startsWith(parent)).length : 1,
        };
      });
    return { ...source, assets };
  }

  async bundle(input: string, commit: string, path: string) {
    if (!/^[a-f0-9]{40}$/i.test(commit) || !safeAssetPath(path))
      throw new Error("Selecione uma revisão e um caminho válidos do catálogo.");
    const tree = await this.tree(input, commit);
    const root = path.slice(0, path.lastIndexOf("/") + 1);
    const skill = path.endsWith("SKILL.md");
    if (!skill && !/\.(agent|instructions|prompt)\.md$/.test(path))
      throw new Error("Tipo de plugin não suportado.");
    const files = tree.files.filter((file) =>
      skill ? file.path.startsWith(root) : file.path === path
    );
    if (!files.some((file) => file.path === path))
      throw new Error("O plugin não existe nesta revisão.");
    if (
      files.length > 200 ||
      files.reduce((sum, file) => sum + (file.size ?? MAX_FILE), 0) > MAX_BUNDLE ||
      files.some((file) => (file.size ?? 0) > MAX_FILE)
    ) {
      throw new Error(
        "Plugin excede o limite de 200 arquivos, 1 MiB por arquivo ou 8 MiB no total."
      );
    }
    const downloaded: { path: string; content: Uint8Array }[] = [];
    let total = 0;
    // Four workers limit GitHub concurrency without mutating the registry on failure.
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, files.length) }, async () => {
        while (next < files.length) {
          const file = files[next++];
          const response = await this.get(
            `${tree.repo}/contents/${file.path.split("/").map(encodeURIComponent).join("/")}?ref=${commit}`,
            true
          );
          const reader = response.body?.getReader();
          if (!reader) throw new Error("Arquivo vazio na resposta do GitHub.");
          const chunks: Uint8Array[] = [];
          let size = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            total += value.byteLength;
            if (size > MAX_FILE || total > MAX_BUNDLE) {
              await reader.cancel();
              throw new Error("Plugin excede o limite de download.");
            }
            chunks.push(value);
          }
          downloaded.push({
            path: skill ? file.path.slice(root.length) : (file.path.split("/").pop() ?? file.path),
            content: Buffer.concat(chunks),
          });
        }
      })
    );
    return { repo: tree.repo, commit, path, files: downloaded };
  }
}
