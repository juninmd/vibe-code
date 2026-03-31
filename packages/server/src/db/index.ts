import {
  createLogQueries,
  createPromptTemplateQueries,
  createRepoQueries,
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
  };
}

export type Db = ReturnType<typeof createDb>;
