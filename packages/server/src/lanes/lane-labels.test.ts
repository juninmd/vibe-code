import { describe, expect, it } from "bun:test";
import {
  defaultLaneLabels,
  issueNumberFromUrl,
  labelChange,
  laneFromIssue,
  laneFromLabels,
  laneOfStatus,
  resolveLaneLabels,
  validateLaneLabels,
} from "@vibe-code/shared";

const github = defaultLaneLabels("github");

describe("lane labels", () => {
  it("uses plain labels on GitHub and exclusive scoped labels on GitLab", () => {
    expect(github).toEqual({
      backlog: "status:todo",
      in_progress: "status:in-progress",
      blocked: "status:blocked",
      review: "status:review",
      done: "status:done",
    });
    expect(defaultLaneLabels("gitlab").review).toBe("status::review");
  });

  it("lets the operator rename single lanes and ignores blank overrides", () => {
    const map = resolveLaneLabels("github", { review: " In QA ", done: "  " });
    expect(map.review).toBe("In QA");
    expect(map.done).toBe("status:done");
    expect(map.backlog).toBe("status:todo");
  });

  it("maps task statuses to lanes; failed work waits with the blocked cards", () => {
    expect(laneOfStatus("in_progress")).toBe("in_progress");
    expect(laneOfStatus("failed")).toBe("blocked");
    expect(laneOfStatus("scheduled")).toBeNull();
    expect(laneOfStatus("archived")).toBeNull();
  });

  it("reads the lane from labels case-insensitively and ignores unrelated labels", () => {
    expect(laneFromLabels(["bug", "Status:Review"], github)).toBe("review");
    expect(laneFromLabels(["bug", "help wanted"], github)).toBeNull();
  });

  it("takes the furthest lane when an issue carries several", () => {
    expect(laneFromLabels(["status:todo", "status:in-progress"], github)).toBe("in_progress");
    expect(laneFromLabels(["status:done", "status:todo"], github)).toBe("done");
  });

  it("counts a closed issue without a lane label as done", () => {
    expect(laneFromIssue({ labels: [], state: "closed" }, github)).toBe("done");
    expect(laneFromIssue({ labels: [], state: "open" }, github)).toBeNull();
    expect(laneFromIssue({ labels: ["status:review"], state: "closed" }, github)).toBe("review");
  });

  it("changes only lane labels when moving an issue", () => {
    expect(labelChange(["bug", "status:todo"], github, "review")).toEqual({
      add: ["status:review"],
      remove: ["status:todo"],
    });
    expect(labelChange(["bug", "status:review"], github, "review")).toEqual({
      add: [],
      remove: [],
    });
    expect(labelChange([], github, "done")).toEqual({ add: ["status:done"], remove: [] });
  });

  it("rejects labels that cannot work as lanes", () => {
    expect(validateLaneLabels({ review: "a", done: "A" })).toContain("cannot use the same label");
    expect(validateLaneLabels({ review: "a,b" })).toContain("comma");
    expect(validateLaneLabels({ review: "x".repeat(51) })).toContain("longer");
    expect(validateLaneLabels({ review: "QA", done: "Shipped" })).toBeNull();
    expect(validateLaneLabels({ review: "", done: "" })).toBeNull();
  });

  it("finds the issue number in GitHub and GitLab URLs", () => {
    expect(issueNumberFromUrl("https://github.com/o/r/issues/12")).toBe(12);
    expect(issueNumberFromUrl("https://gitlab.com/g/sub/p/-/issues/7#note_1")).toBe(7);
    expect(issueNumberFromUrl("https://github.com/o/r/pull/12")).toBeNull();
    expect(issueNumberFromUrl(null)).toBeNull();
  });
});
