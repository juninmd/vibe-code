import { spawn } from "node:child_process";

const STOP_WORDS = new Set(
  `the a an is are was were be been being have has had do does did will would could should may might can to of in on for with and or but not this that it as at by from
de da do das dos em na no nas nos um uma uns umas por para com sem sob como mais menos muito que se ao aos
add fix update change create remove delete implement feature bug issue error new file code function method`.split(
    /\s+/
  )
);

const EXCLUDE_DIRS = ["node_modules", ".git", "dist", "build", ".next", "coverage", ".cache"];

/** Keywords worth grepping for: strips code/URLs/markdown, drops stop words, ranks by frequency. */
export function extractKeywords(text: string, max = 8): string[] {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_[\](){}|>~]/g, " ");
  const freq = new Map<string, number>();
  for (const w of cleaned.toLowerCase().split(/[^\p{L}\p{N}_-]+/u)) {
    if (w.length < 4 || STOP_WORDS.has(w) || /^\d+$/.test(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return [...freq]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([w]) => w);
}

function run(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn("git", args, { cwd });
    let out = "";
    p.stdout.on("data", (d) => {
      out += d;
    });
    p.on("error", () => resolve(""));
    p.on("close", () => resolve(out));
  });
}

/** Ranks tracked files by how many task keywords they contain (via `git grep -c`). */
export async function findRelevantFiles(cwd: string, text: string, limit = 10): Promise<string[]> {
  const keywords = extractKeywords(text);
  if (keywords.length === 0) return [];
  const args = [
    "grep",
    "-i",
    "-c",
    "-I",
    ...keywords.flatMap((k) => ["-e", k]),
    "--",
    ".",
    ...EXCLUDE_DIRS.map((d) => `:(exclude)${d}`),
  ];
  const out = await run(cwd, args);
  return out
    .split("\n")
    .map((l) => {
      const i = l.lastIndexOf(":");
      return i > 0 ? { file: l.slice(0, i), n: Number(l.slice(i + 1)) } : null;
    })
    .filter(
      (x): x is { file: string; n: number } =>
        !!x && x.n > 0 && !/\.(lock|map|svg|png|jpg)$/.test(x.file)
    )
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((x) => x.file);
}

export async function buildEnrichmentContext(
  cwd: string,
  title: string,
  description: string
): Promise<string> {
  const files = await findRelevantFiles(cwd, `${title}\n${description}`);
  return files.length ? `## Likely relevant files\n${files.map((f) => `- ${f}`).join("\n")}` : "";
}
