import {
  createArtifactQueries,
  createFindingsQueries,
  createLabelQueries,
  createLogQueries,
  createMemoryQueries,
  createMetricsQueries,
  createPromptTemplateQueries,
  createRepoQueries,
  createReviewIssueQueries,
  createReviewRoundQueries,
  createRunQueries,
  createScheduleQueries,
  createSettingsQueries,
  createTaskQueries,
} from "./queries";
import { initDatabase } from "./schema";

export function createDb(dbPath: string) {
  const db = initDatabase(dbPath);

  return {
    raw: db,
    repos: createRepoQueries(db),
    tasks: createTaskQueries(db),
    runs: createRunQueries(db),
    logs: createLogQueries(db),
    settings: createSettingsQueries(db),
    prompts: createPromptTemplateQueries(db),
    schedules: createScheduleQueries(db),
    findings: createFindingsQueries(db),
    metrics: createMetricsQueries(db),
    artifacts: createArtifactQueries(db),
    labels: createLabelQueries(db),
    memories: createMemoryQueries(db),
    reviewRounds: createReviewRoundQueries(db),
    reviewIssues: createReviewIssueQueries(db),
  };
}

export type Db = ReturnType<typeof createDb>;
