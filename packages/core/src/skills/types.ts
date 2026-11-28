/**
 * Skill Definition Types
 * Reusable task template with defined inputs/outputs and execution plan
 */

export interface SkillParameter {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "array";
  description: string;
  required?: boolean;
  default?: unknown;
}

export interface SkillAgent {
  engine: string;
  model?: string;
  prompt?: string;
  config?: Record<string, unknown>;
}

export interface SkillDefinition {
  agents: SkillAgent[];
  sequence: "parallel" | "serial";
  timeout?: number;
  fallback?: boolean;
  metadata?: Record<string, unknown>;
}

export interface Skill {
  id: string;
  workspaceId: string;
  name: string;
  slug?: string;
  description?: string;
  definition: SkillDefinition;
  inputs: SkillParameter[];
  outputs: SkillParameter[];
  version: number;
  createdBy?: string;
  tags?: string[];
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Skill execution request
 */
export interface SkillExecutionRequest {
  skillId: string;
  inputs: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * Skill execution result
 */
export interface SkillExecutionResult {
  id: string;
  skillId: string;
  status: "running" | "completed" | "failed";
  outputs?: Record<string, unknown>;
  error?: string;
  startedAt: string;
  completedAt?: string;
}
