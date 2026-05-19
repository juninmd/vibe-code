import { describe, expect, it } from "bun:test";
import { GitService } from "./git-service";

// Access private withRepoLock via cast — exercising the lock in isolation.
type LockFn = <T>(barePath: string, fn: () => Promise<T>) => Promise<T>;
const withRepoLock = (GitService as unknown as { withRepoLock: LockFn }).withRepoLock.bind(
  GitService
);

describe("GitService per-repo lock", () => {
  it("serializes concurrent mutations on the same bare path", async () => {
    const order: string[] = [];
    const slow = (label: string, ms: number) =>
      withRepoLock("/bare/A", async () => {
        order.push(`${label}:start`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`${label}:end`);
      });

    await Promise.all([slow("op1", 30), slow("op2", 5), slow("op3", 5)]);

    // op1:end must appear before op2:start (serialized on /bare/A).
    expect(order).toEqual(["op1:start", "op1:end", "op2:start", "op2:end", "op3:start", "op3:end"]);
  });

  it("runs different bare paths concurrently", async () => {
    const order: string[] = [];
    const op = (path: string, label: string, ms: number) =>
      withRepoLock(path, async () => {
        order.push(`${label}:start`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`${label}:end`);
      });

    await Promise.all([op("/bare/B", "x", 20), op("/bare/C", "y", 5)]);

    // y completes before x because they don't share a lock.
    expect(order.indexOf("y:end")).toBeLessThan(order.indexOf("x:end"));
  });
});
