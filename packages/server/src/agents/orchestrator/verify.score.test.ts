import { expect, test, describe } from "bun:test";
import { computeRunQualityScore } from "./verify";

describe("computeRunQualityScore", () => {
  test("reduces score for retries and review findings", () => {
    const score = computeRunQualityScore({
      validatorAttempts: 3,
      reviewBlockers: 1,
      reviewWarnings: 2,
      finalStatus: "completed",
      prCreated: true,
    });

    expect(score).toBe(61);
  });

  test("clamps score to the 0..100 range", () => {
    const score = computeRunQualityScore({
      validatorAttempts: 8,
      reviewBlockers: 5,
      reviewWarnings: 10,
      finalStatus: "failed",
      prCreated: false,
    });

    expect(score).toBe(0);
  });
});
