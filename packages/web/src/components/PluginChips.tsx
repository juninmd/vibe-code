import type { AppliedSkill, HarnessEngine, SkillPlan } from "@vibe-code/shared";
import { ModeBadge } from "./SkillPicker";

interface PluginChipsProps {
  plan: SkillPlan | null;
  engine: HarnessEngine;
  /** Drop a manually picked skill. */
  onRemove: (name: string) => void;
}

const WHERE: Record<HarnessEngine, string> = {
  "claude-code": "Loaded as a session-only Claude Code plugin. Nothing is written to your repo.",
  opencode: "Added to .opencode/skill in the workspace and kept out of git.",
};

function Chip({ skill, onRemove }: { skill: AppliedSkill; onRemove: (name: string) => void }) {
  const reason = skill.reasons.join(", ");
  const tone =
    skill.source === "auto"
      ? "border-accent/30 bg-accent/10 text-accent-text"
      : skill.source === "manual"
        ? "border-white/15 text-text-secondary"
        : "border-white/10 bg-white/5 text-text-dimmed";
  return (
    <li
      title={reason}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${tone}`}
    >
      <span className="truncate font-medium">{skill.name}</span>
      <span className="truncate text-[11px] opacity-70">{reason}</span>
      {skill.source === "manual" && (
        <button
          type="button"
          aria-label={`Remove ${skill.name}`}
          onClick={() => onRemove(skill.name)}
          className="-mr-1 rounded-full px-1 text-text-dimmed hover:text-text-primary"
        >
          ×
        </button>
      )}
    </li>
  );
}

/** What the agent plugin will contain for this task, and why — visible before Start. */
export function PluginChips({ plan, engine, onRemove }: PluginChipsProps) {
  if (!plan) return null;
  const hasPicks = plan.applied.some((skill) => skill.source !== "always");
  return (
    <section aria-label="Plugins" className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-medium text-text-secondary">Plugins</h3>
        <ModeBadge mode={plan.mode} />
      </div>
      {plan.applied.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {plan.applied.map((skill) => (
            <Chip key={skill.name} skill={skill} onRemove={onRemove} />
          ))}
        </ul>
      )}
      <p className="text-[11px] leading-snug text-text-dimmed">
        {!hasPicks && plan.mode === "auto"
          ? "No skill matches this task yet. Add one with Skills."
          : WHERE[engine]}
      </p>
    </section>
  );
}
