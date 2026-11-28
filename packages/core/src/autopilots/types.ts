/**
 * Autopilot System Types
 * Automated task orchestration with skill-based workflows
 */

export interface AutopilotTrigger {
  type: "manual" | "schedule" | "webhook" | "event";
  config?: Record<string, unknown>;
}

export interface AutopilotStep {
  id: string;
  skillId: string;
  inputs: Record<string, unknown>;
  onSuccess?: {
    action: "next" | "branch" | "end";
    targetStepId?: string;
  };
  onFailure?: {
    action: "retry" | "skip" | "branch" | "abort";
    targetStepId?: string;
    maxRetries?: number;
  };
}

export interface Autopilot {
  id: string;
  workspaceId: string;
  name: string;
  slug?: string;
  description?: string;
  trigger: AutopilotTrigger;
  steps: AutopilotStep[];
  enabled: boolean;
  version: number;
  createdBy?: string;
  tags?: string[];
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Autopilot execution request
 */
export interface AutopilotExecutionRequest {
  autopilotId: string;
  context?: Record<string, unknown>;
}

/**
 * Autopilot run (execution instance)
 */
export interface AutopilotRun {
  id: string;
  autopilotId: string;
  status: "queued" | "running" | "completed" | "failed";
  stepsExecuted: number;
  totalSteps: number;
  error?: string;
  triggeredAt: string;
  startedAt?: string;
  completedAt?: string;
  results?: Record<string, unknown>;
}
