import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('packages/server/src/db/index.test.ts', 'utf-8');

// Instead of matching exact string, we'll append a test for "extractRepoName" fallback path to queries.test.ts
let queriesContent = readFileSync('packages/server/src/db/queries.test.ts', 'utf-8');

queriesContent = queriesContent.replace(
  'it("extracts repo name from URL", () => {',
  `it("extracts repo name from bare URL", () => {
    const db = makeDb();
    const repo = db.repos.create({ url: "my-bare-project" });
    expect(repo.name).toBe("my-bare-project");
  });

  it("extracts repo name from URL", () => {`
);

writeFileSync('packages/server/src/db/queries.test.ts', queriesContent);
