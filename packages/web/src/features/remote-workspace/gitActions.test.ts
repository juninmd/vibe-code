import { describe, expect, it } from "vitest";
import { resolvePublishAction } from "./gitActions";

const idle = { working: false, publishing: false, prUrl: null, changedFiles: 2 };

describe("resolvePublishAction", () => {
  it("offers to create the PR when the branch has changes", () => {
    expect(resolvePublishAction(idle)).toEqual({
      label: "Criar PR",
      disabled: false,
      primary: true,
      hint: "Commit, push e abertura do pull request (2 arquivos)",
    });
  });

  it("updates the same PR once it exists, as a secondary action", () => {
    expect(resolvePublishAction({ ...idle, prUrl: "https://x/pr/1" })).toMatchObject({
      label: "Atualizar PR",
      primary: false,
      disabled: false,
    });
  });

  it("blocks publishing while the agent is mid-turn, so a half-done edit is never pushed", () => {
    expect(resolvePublishAction({ ...idle, working: true })).toMatchObject({
      disabled: true,
      hint: "Aguarde o turno terminar",
    });
  });

  it("does not offer an empty PR", () => {
    expect(resolvePublishAction({ ...idle, changedFiles: 0 })).toMatchObject({
      disabled: true,
      primary: false,
      hint: "Sem alterações para publicar",
    });
  });

  it("stays usable while the diff is still loading", () => {
    expect(resolvePublishAction({ ...idle, changedFiles: null })).toMatchObject({
      disabled: false,
      hint: "Commit, push e abertura do pull request",
    });
  });

  it("shows progress and prevents a double submit", () => {
    expect(resolvePublishAction({ ...idle, publishing: true })).toMatchObject({
      label: "Publicando…",
      disabled: true,
    });
  });
});
