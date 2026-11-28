import { describe, expect, it } from "bun:test";
import { createDb } from "../db";
import {
  consumeGrant,
  detectExplicitPrRequest,
  findActiveGrant,
  grantPr,
  listGrants,
  revokeTaskGrants,
} from "./pr-grants";

function task(db: ReturnType<typeof createDb>) {
  const workspace = db.workspaces.create({ name: "W", slug: `w-${Math.random()}` });
  const repo = db.repos.create({
    url: `https://github.com/acme/r-${Math.random()}.git`,
    workspaceId: workspace.id,
  });
  const created = db.tasks.create({ title: "Session", repoId: repo.id });
  return { repo, task: created };
}

describe("explicit PR requests", () => {
  it.each([
    "abra um PR",
    "Abra um PR para main, por favor",
    "por favor, crie um pull request",
    "open a PR",
    "quero que você abra um PR",
    "publique o PR",
    "gere um merge request",
    "create a pull request against release",
  ])("authorizes %p", (text) => {
    expect(detectExplicitPrRequest(text)).toBe(true);
  });

  it.each([
    "posso abrir um PR?",
    "talvez abra um PR depois",
    "não abra um PR ainda",
    "o agente deve abrir um PR sozinho",
    "será que vale abrir um PR",
    "discuta se devemos criar um PR",
    "o PR foi aberto pelo agente",
    "quero revisar o PR",
    "como faço para abrir um PR",
    "o arquivo EVIDENCE.md menciona abrir um PR",
  ])("does not authorize %p", (text) => {
    expect(detectExplicitPrRequest(text)).toBe(false);
  });
});

describe("pr grants", () => {
  it("records who authorized and for which branches", () => {
    const db = createDb(":memory:");
    const { repo, task: session } = task(db);
    const grant = grantPr(db, {
      taskId: session.id,
      accountId: "acc-1",
      source: "explicit_command",
      turnId: "run-1",
      repoId: repo.id,
      headBranch: "feat/x",
      targetBranch: "main",
    });
    expect(grant.account_id).toBe("acc-1");
    expect(grant.source).toBe("explicit_command");
    expect(grant.turn_id).toBe("run-1");
    expect(grant.head_branch).toBe("feat/x");
    expect(grant.target_branch).toBe("main");
    db.close();
  });

  it("reuses the active grant for the same branch pair only", () => {
    const db = createDb(":memory:");
    const { repo, task: session } = task(db);
    const base = {
      taskId: session.id,
      repoId: repo.id,
      headBranch: "feat/x",
      targetBranch: "main",
    };
    const first = grantPr(db, { ...base, source: "api_request" });
    const again = grantPr(db, { ...base, source: "explicit_command", turnId: "run-2" });
    expect(again.id).toBe(first.id);
    expect(again.source).toBe("explicit_command");
    expect(listGrants(db, session.id)).toHaveLength(1);
    expect(findActiveGrant(db, session.id, { ...base, targetBranch: "release" })).toBeNull();
    db.close();
  });

  it("consumes on publish and refuses a consumed grant", () => {
    const db = createDb(":memory:");
    const { repo, task: session } = task(db);
    const grant = grantPr(db, {
      taskId: session.id,
      repoId: repo.id,
      source: "api_request",
      headBranch: "feat/x",
      targetBranch: "main",
    });
    consumeGrant(db, grant.id);
    expect(
      findActiveGrant(db, session.id, {
        repoId: repo.id,
        headBranch: "feat/x",
        targetBranch: "main",
      })
    ).toBeNull();
    db.close();
  });

  it("revokes every pending grant when the session is cancelled", () => {
    const db = createDb(":memory:");
    const { repo, task: session } = task(db);
    grantPr(db, {
      taskId: session.id,
      repoId: repo.id,
      source: "explicit_command",
      headBranch: "feat/x",
      targetBranch: "main",
    });
    expect(revokeTaskGrants(db, session.id, "cancelled")).toBe(1);
    expect(
      findActiveGrant(db, session.id, {
        repoId: repo.id,
        headBranch: "feat/x",
        targetBranch: "main",
      })
    ).toBeNull();
    expect(listGrants(db, session.id)[0].revoked_reason).toBe("cancelled");
    db.close();
  });
});
