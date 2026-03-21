import { initDatabase } from "./schema";
import { createRepoQueries, createTaskQueries, createRunQueries, createLogQueries } from "./queries";

export function createDb(dbPath: string) {
  const db = initDatabase(dbPath);

  return {
    raw: db,
    repos: createRepoQueries(db),
    tasks: createTaskQueries(db),
    runs: createRunQueries(db),
    logs: createLogQueries(db),
  };
}

export type Db = ReturnType<typeof createDb>;
