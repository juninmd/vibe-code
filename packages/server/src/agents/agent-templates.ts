import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type AgentTemplateSkillRef = {
  source_url: string;
  cached_name: string;
  cached_description: string;
};

export type AgentTemplate = {
  slug: string;
  name: string;
  description: string;
  category?: string;
  icon?: string;
  accent?: string;
  instructions: string;
  skills: AgentTemplateSkillRef[];
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validate(t: AgentTemplate, filename: string): void {
  if (!t.slug) throw new Error(`${filename}: missing slug`);
  if (!SLUG_PATTERN.test(t.slug))
    throw new Error(`${filename}: slug "${t.slug}" must be lowercase kebab-case`);
  if (filename !== `${t.slug}.json`)
    throw new Error(`${filename}: slug "${t.slug}" does not match filename`);
  if (!t.name?.trim()) throw new Error(`${filename}: missing name`);
  if (!t.instructions?.trim()) throw new Error(`${filename}: missing instructions`);
  for (const [i, s] of (t.skills ?? []).entries()) {
    if (!s.source_url?.trim()) throw new Error(`${filename}: skill[${i}] missing source_url`);
  }
}

export class AgentTemplateRegistry {
  private bySlug = new Map<string, AgentTemplate>();
  private order: string[] = [];

  constructor(templatesDir: string = join(import.meta.dir, "templates")) {
    const files = readdirSync(templatesDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    for (const file of files) {
      const raw = readFileSync(join(templatesDir, file), "utf8");
      const t = JSON.parse(raw) as AgentTemplate;
      validate(t, file);
      if (this.bySlug.has(t.slug)) throw new Error(`duplicate slug: ${t.slug}`);
      this.bySlug.set(t.slug, t);
      this.order.push(t.slug);
    }
  }

  list(): AgentTemplate[] {
    return this.order.map((slug) => this.bySlug.get(slug)!);
  }

  get(slug: string): AgentTemplate | undefined {
    return this.bySlug.get(slug);
  }

  size(): number {
    return this.order.length;
  }
}
