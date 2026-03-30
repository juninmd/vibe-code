import {
  createLogQueries,
  createPromptTemplateQueries,
  createRepoQueries,
  createRunQueries,
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
  };
}

export type Db = ReturnType<typeof createDb>;
