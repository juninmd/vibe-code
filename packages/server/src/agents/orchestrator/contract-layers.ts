import type { ContractBundle, ContractLayer } from "@vibe-code/shared";

export interface BuildContractBundleInput {
  globalRules?: string;
  repoContract?: string;
  workflowContract?: string;
  taskContext?: string;
}

function toLayer(
  id: ContractLayer["id"],
  title: string,
  priority: number,
  content: string | undefined,
  source: string
): ContractLayer | null {
  if (!content?.trim()) return null;
  return {
    id,
    title,
    priority,
    content: content.trim(),
    source,
  };
}

export function buildContractBundle(input: BuildContractBundleInput): ContractBundle {
  const layers = [
    toLayer("global_rules", "Global Rules", 10, input.globalRules, "skills/rules/agents"),
    toLayer("repo_contract", "Repository Contract", 20, input.repoContract, "repo manifests"),
    toLayer(
      "workflow_contract",
      "Workflow Contract",
      30,
      input.workflowContract,
      "matched workflow"
    ),
    toLayer("task_context", "Task Local Context", 40, input.taskContext, "task ancestry/memory"),
  ]
    .filter((layer): layer is ContractLayer => Boolean(layer))
    .sort((left, right) => left.priority - right.priority);

  return { layers };
}
