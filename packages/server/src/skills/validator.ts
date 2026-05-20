import type { SkillsLoader } from "./loader";

export interface SkillValidationResult {
  duplicates: string[];
  missingDeps: Array<{ skill: string; dep: string }>;
  cycles: string[][];
  isValid: boolean;
}

export async function validateSkills(loader: SkillsLoader): Promise<SkillValidationResult> {
  const index = await loader.load();
  const skills = index.skills || [];

  const duplicates: string[] = [];
  const missingDeps: Array<{ skill: string; dep: string }> = [];
  const cycles: string[][] = [];

  // 1. Check for Duplicate Names
  const nameMap = new Map<string, number>();
  for (const s of skills) {
    nameMap.set(s.name, (nameMap.get(s.name) || 0) + 1);
  }
  for (const [name, count] of nameMap.entries()) {
    if (count > 1) {
      duplicates.push(name);
    }
  }

  // 2. Check for Missing Dependencies
  const skillNames = new Set(skills.map((s) => s.name));
  for (const s of skills) {
    if (s.dependencies) {
      for (const dep of s.dependencies) {
        if (!skillNames.has(dep)) {
          missingDeps.push({ skill: s.name, dep });
        }
      }
    }
  }

  // 3. Check for Cyclical Dependencies
  const adj = new Map<string, string[]>();
  for (const s of skills) {
    adj.set(s.name, s.dependencies || []);
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();
  const currentPath: string[] = [];

  function dfs(node: string): boolean {
    visited.add(node);
    recStack.add(node);
    currentPath.push(node);

    const neighbors = adj.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recStack.has(neighbor)) {
        const cycleStartIdx = currentPath.indexOf(neighbor);
        const cycle = currentPath.slice(cycleStartIdx);
        cycle.push(neighbor);
        cycles.push(cycle);
        return true;
      }
    }

    recStack.delete(node);
    currentPath.pop();
    return false;
  }

  for (const s of skills) {
    if (!visited.has(s.name)) {
      dfs(s.name);
    }
  }

  const isValid = duplicates.length === 0 && missingDeps.length === 0 && cycles.length === 0;

  return {
    duplicates,
    missingDeps,
    cycles,
    isValid,
  };
}

export function logValidationReport(report: SkillValidationResult): void {
  if (report.isValid) {
    console.log("[Skills Validator] Static verification passed: 0 conflicts detected.");
    return;
  }

  console.error("┌────────────────────────────────────────────────────────┐");
  console.error("│               SKILL VALIDATION CONFLICTS               │");
  console.error("└────────────────────────────────────────────────────────┘");

  if (report.duplicates.length > 0) {
    console.error("🚨 Duplicate Skill Names Detected:");
    for (const name of report.duplicates) {
      console.error(`   - "${name}" is defined multiple times.`);
    }
  }

  if (report.missingDeps.length > 0) {
    console.error("🚨 Missing Dependencies Detected:");
    for (const item of report.missingDeps) {
      console.error(`   - Skill "${item.skill}" requires missing dependency "${item.dep}"`);
    }
  }

  if (report.cycles.length > 0) {
    console.error("🚨 Cyclical Dependencies Detected:");
    for (const cycle of report.cycles) {
      console.error(`   - Cycle: ${cycle.join(" -> ")}`);
    }
  }
  console.error("──────────────────────────────────────────────────────────");
}
