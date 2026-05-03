import type {
  Task,
  TaskExecutionPlan,
  TaskExecutionPlanNode,
  TaskPlanMaterialization,
} from "@vibe-code/shared";
import type { Db } from "../../db";

const MAX_PLAN_NODES = 5;

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const normalized = line.trim().replace(/\s+/g, " ");
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function extractCandidateSteps(task: Task): string[] {
  const sources = [task.plannerSpec, task.goal, task.desiredOutcome, task.description]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");

  const bulletLines = Array.from(
    sources.matchAll(/^\s*(?:[-*+] |\d+[.)] |\[[ xX]\] )(.+)$/gm),
    (match) => match[1]
  );
  if (bulletLines.length > 0) {
    return uniqueLines(bulletLines).slice(0, MAX_PLAN_NODES);
  }

  const sentenceLines = sources
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 24);

  if (sentenceLines.length > 0) {
    return uniqueLines(sentenceLines).slice(0, MAX_PLAN_NODES);
  }

  return [
    `Clarify the scope and constraints for ${task.title}.`,
    `Implement the core changes required for ${task.title}.`,
    `Validate, review, and document the outcome for ${task.title}.`,
  ];
}

function inferTaskType(text: string): string {
  const lower = text.toLowerCase();
  if (/(ui|ux|component|css|layout|screen|page|react|frontend)/.test(lower)) return "frontend";
  if (/(test|assert|coverage|vitest|integration|e2e)/.test(lower)) return "test";
  if (/(doc|readme|guide|changelog|spec|workflow)/.test(lower)) return "docs";
  if (/(infra|docker|deploy|pipeline|ci|kubernetes|terraform)/.test(lower)) return "infra";
  if (/(refactor|cleanup|simplify|restructure)/.test(lower)) return "refactor";
  if (/(bug|fix|regression|broken|failure|error)/.test(lower)) return "bugfix";
  if (/(chore|maintenance|upgrade|dependency|rename)/.test(lower)) return "chore";
  return "backend";
}

function inferAcceptanceCriteria(step: string): string[] {
  const criteria = [step];
  if (!/(test|validate|verify|review)/i.test(step)) {
    criteria.push("Validation artifacts and deterministic checks are attached.");
  }
  return criteria;
}

function isTerminalNode(step: string): boolean {
  return /(validate|verification|review|document|handoff|qa|test)/i.test(step);
}

function isPreparationNode(step: string): boolean {
  return /(clarify|analy[sz]e|prepare|audit|inspect|map|triage)/i.test(step);
}

function buildPlanNodes(_task: Task, steps: string[]): TaskExecutionPlanNode[] {
  const effectiveSteps = steps.slice(0, MAX_PLAN_NODES);
  const prepIds: string[] = [];
  const executionIds: string[] = [];

  return effectiveSteps.map((step, index) => {
    const id = `node-${index + 1}`;
    let dependsOn: string[] = [];

    if (isTerminalNode(step)) {
      dependsOn =
        executionIds.length > 0
          ? [...executionIds]
          : index > 0
            ? [effectiveSteps[index - 1] ? `node-${index}` : ""]
            : [];
      dependsOn = dependsOn.filter(Boolean);
    } else if (isPreparationNode(step)) {
      dependsOn = prepIds.length > 0 ? [prepIds[prepIds.length - 1]] : [];
      prepIds.push(id);
    } else if (prepIds.length > 0) {
      dependsOn = [prepIds[prepIds.length - 1]];
      executionIds.push(id);
    } else if (executionIds.length > 0) {
      dependsOn = [executionIds[executionIds.length - 1]];
      executionIds.push(id);
    } else {
      executionIds.push(id);
    }

    return {
      id,
      title: step.length > 96 ? `${step.slice(0, 93).trimEnd()}...` : step,
      description: step,
      dependsOn,
      acceptanceCriteria: inferAcceptanceCriteria(step),
      tags: [inferTaskType(step), "planned"],
    };
  });
}

function distributeBudget(maxCost: number | null | undefined, count: number): number[] {
  if (!maxCost || count <= 0) return [];
  const perNode = Number((maxCost / count).toFixed(2));
  return Array.from({ length: count }, (_, index) => {
    if (index === count - 1) {
      return Number((maxCost - perNode * (count - 1)).toFixed(2));
    }
    return perNode;
  });
}

export function buildTaskExecutionPlan(task: Task): TaskExecutionPlan {
  const steps = extractCandidateSteps(task);
  const nodes = buildPlanNodes(task, steps);
  return {
    objective: task.goal?.trim() || task.title,
    summary: `Execution plan for ${task.title} with ${nodes.length} delegated steps.`,
    source: "heuristic",
    generatedAt: new Date().toISOString(),
    nodes,
  };
}

export function materializeTaskExecutionPlan(
  db: Db,
  parentTask: Task,
  plan: TaskExecutionPlan,
  options?: { force?: boolean }
): TaskPlanMaterialization {
  const existingChildren = db.tasks.listChildren(parentTask.id);
  if (existingChildren.length > 0 && !options?.force) {
    db.artifacts.upsert({
      taskId: parentTask.id,
      kind: "plan",
      title: "Execution plan",
      uri: `task-plan:${parentTask.id}`,
      metadata: {
        plan,
        childTaskIds: existingChildren.map((task) => task.id),
        reused: true,
      },
    });
    return { plan, createdTasks: [], reusedTasks: existingChildren };
  }

  const budgets = distributeBudget(parentTask.maxCost, plan.nodes.length);
  const nodeIdToTaskId = new Map<string, string>();
  const createdTasks = plan.nodes.map((node, index) => {
    const childTask = db.tasks.create({
      title: node.title,
      description: `${node.description}\n\nAcceptance:\n- ${node.acceptanceCriteria.join("\n- ")}`,
      repoId: parentTask.repoId,
      parentTaskId: parentTask.id,
      engine: parentTask.engine ?? undefined,
      model: parentTask.model ?? undefined,
      baseBranch: parentTask.baseBranch ?? undefined,
      priority: parentTask.priority,
      tags: Array.from(new Set([...(parentTask.tags ?? []), ...node.tags])),
      agentId: node.agentId ?? parentTask.agentId ?? undefined,
      workflowId: node.workflowId ?? parentTask.workflowId ?? undefined,
      maxCost: node.maxCost ?? budgets[index],
      goal: node.description,
      desiredOutcome: node.acceptanceCriteria.join("; "),
    });
    nodeIdToTaskId.set(node.id, childTask.id);
    return childTask;
  });

  const materializedTasks = [...createdTasks];

  for (const [index, node] of plan.nodes.entries()) {
    const taskId = materializedTasks[index]?.id;
    if (!taskId) continue;
    const dependsOn = node.dependsOn
      .map((dependencyId) => nodeIdToTaskId.get(dependencyId))
      .filter((dependencyId): dependencyId is string => Boolean(dependencyId));
    if (dependsOn.length > 0 || budgets[index] !== undefined) {
      const updatedTask = db.tasks.update(taskId, {
        dependsOn,
        maxCost: node.maxCost ?? budgets[index],
      });
      if (updatedTask) materializedTasks[index] = updatedTask;
    }
  }

  db.artifacts.upsert({
    taskId: parentTask.id,
    kind: "plan",
    title: "Execution plan",
    uri: `task-plan:${parentTask.id}`,
    metadata: {
      plan,
      childTaskIds: materializedTasks.map((task) => task.id),
      reused: false,
    },
  });

  return { plan, createdTasks: materializedTasks, reusedTasks: [] };
}
