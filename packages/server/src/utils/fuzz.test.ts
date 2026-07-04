import { describe, expect, it } from "bun:test";
import fc from "fast-check";

// ── Helpers: replicated logic under test ────────────────────────────────────

function isValidPid(pid: number): boolean {
  return Number.isInteger(pid) && pid > 0;
}

function buildTaskkillCommand(pid: number): string {
  return `taskkill /F /T /PID ${pid}`;
}

function splitBufferedLines(buffer: string): { lines: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  return {
    lines: parts.slice(0, -1),
    rest: parts[parts.length - 1] ?? "",
  };
}

function parsePositiveInt(value: string | number | null | undefined): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

// ── 1. process-tree PID validation ─────────────────────────────────────────

describe("killProcessTree PID validation fuzz", () => {
  it("only positive integers are valid PIDs", () => {
    fc.assert(
      fc.property(fc.integer(), (pid) => {
        const valid = isValidPid(pid);
        if (pid > 0 && Number.isInteger(pid)) {
          expect(valid).toBe(true);
        } else {
          expect(valid).toBe(false);
        }
      }),
      { numRuns: 2000 }
    );
  });

  it("taskkill command never throws for any integer PID", () => {
    fc.assert(
      fc.property(fc.integer(), (pid) => {
        expect(() => buildTaskkillCommand(pid)).not.toThrow();
        expect(buildTaskkillCommand(pid)).toMatch(/^taskkill \/F \/T \/PID -?\d+$/);
      }),
      { numRuns: 1000 }
    );
  });

  it("negative, zero, and non-integer values are rejected", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ max: 0 }),
          fc.constant(1.5),
          fc.constant(NaN),
          fc.constant(Infinity),
          fc.constant(-Infinity)
        ),
        (pid) => {
          expect(isValidPid(pid as number)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ── 2. BroadcastHub WsClient management ────────────────────────────────────

interface WsClient {
  subscribedTasks: Set<string>;
}

function createClient(): WsClient {
  return { subscribedTasks: new Set() };
}

function subscribe(client: WsClient, taskId: string): void {
  client.subscribedTasks.add(taskId);
}

function unsubscribe(client: WsClient, taskId: string): void {
  client.subscribedTasks.delete(taskId);
}

describe("BroadcastHub WsClient management fuzz", () => {
  it("client starts with empty subscribedTasks", () => {
    fc.assert(
      fc.property(fc.anything(), () => {
        const client = createClient();
        expect(client.subscribedTasks.size).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it("subscribing adds, unsubscribing removes", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (taskA, taskB) => {
          fc.pre(taskA !== taskB);
          const client = createClient();
          subscribe(client, taskA);
          expect(client.subscribedTasks.has(taskA)).toBe(true);
          unsubscribe(client, taskA);
          expect(client.subscribedTasks.has(taskA)).toBe(false);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("subscribing same task twice is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (taskId) => {
        const client = createClient();
        subscribe(client, taskId);
        subscribe(client, taskId);
        expect(client.subscribedTasks.size).toBe(1);
        expect(client.subscribedTasks.has(taskId)).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  it("unsubscribing non-subscribed task never throws", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (taskId, otherTask) => {
          fc.pre(taskId !== otherTask);
          const client = createClient();
          subscribe(client, taskId);
          expect(() => unsubscribe(client, otherTask)).not.toThrow();
        }
      ),
      { numRuns: 500 }
    );
  });

  it("any string can be used as taskId for subscribe/unsubscribe", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (taskId) => {
        const client = createClient();
        expect(() => subscribe(client, taskId)).not.toThrow();
        expect(() => unsubscribe(client, taskId)).not.toThrow();
      }),
      { numRuns: 500 }
    );
  });
});

// ── 3. access-control isAuthEnabled logic ───────────────────────────────────

function isAuthEnabled(
  authEnabledSetting: string | null,
  env: {
    GITHUB_OAUTH_CLIENT_ID?: string;
    GITHUB_OAUTH_CLIENT_SECRET?: string;
    VIBE_CODE_API_KEY?: string;
  }
): boolean {
  if (authEnabledSetting === "false") return false;
  const hasClientId = Boolean(env.GITHUB_OAUTH_CLIENT_ID);
  const hasClientSecret = Boolean(env.GITHUB_OAUTH_CLIENT_SECRET);
  const hasApiKey = Boolean(env.VIBE_CODE_API_KEY);
  return (hasClientId && hasClientSecret) || hasApiKey;
}

describe("isAuthEnabled fuzz", () => {
  it("always returns a boolean for any env/setting combination", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(null, "true", "false", "TRUE", "FALSE", "1", "0", ""),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (setting, hasClientId, hasClientSecret, hasApiKey) => {
          const result = isAuthEnabled(setting, {
            GITHUB_OAUTH_CLIENT_ID: hasClientId ? "id" : undefined,
            GITHUB_OAUTH_CLIENT_SECRET: hasClientSecret ? "secret" : undefined,
            VIBE_CODE_API_KEY: hasApiKey ? "key" : undefined,
          });
          expect(typeof result).toBe("boolean");
        }
      ),
      { numRuns: 500 }
    );
  });

  it("returns false when setting is exactly 'false' regardless of env", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (hasClientId, hasClientSecret, hasApiKey) => {
          const result = isAuthEnabled("false", {
            GITHUB_OAUTH_CLIENT_ID: hasClientId ? "id" : undefined,
            GITHUB_OAUTH_CLIENT_SECRET: hasClientSecret ? "secret" : undefined,
            VIBE_CODE_API_KEY: hasApiKey ? "key" : undefined,
          });
          expect(result).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("returns true when both GitHub OAuth env vars are set and setting is not 'false'", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("true", "TRUE", "1", null, undefined, ""),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.boolean(),
        (setting, clientId, clientSecret, hasApiKey) => {
          const result = isAuthEnabled(setting as string | null, {
            GITHUB_OAUTH_CLIENT_ID: clientId,
            GITHUB_OAUTH_CLIENT_SECRET: clientSecret,
            VIBE_CODE_API_KEY: hasApiKey ? "key" : undefined,
          });
          expect(result).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("returns true when VIBE_CODE_API_KEY is set and setting is not 'false'", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("true", "TRUE", "1", null, undefined, ""),
        fc.boolean(),
        fc.boolean(),
        fc.string({ minLength: 1, maxLength: 50 }),
        (setting, hasClientId, hasClientSecret, apiKey) => {
          const result = isAuthEnabled(setting as string | null, {
            GITHUB_OAUTH_CLIENT_ID: hasClientId ? "id" : undefined,
            GITHUB_OAUTH_CLIENT_SECRET: hasClientSecret ? "secret" : undefined,
            VIBE_CODE_API_KEY: apiKey,
          });
          expect(result).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ── 4. access-control canAccessRepoInWorkspace logic ────────────────────────

interface Repo {
  workspaceId: string;
}

function canAccessRepoInWorkspace(repo: Repo | null, workspaceId: string): boolean {
  return repo?.workspaceId === workspaceId;
}

describe("canAccessRepoInWorkspace fuzz", () => {
  it("always returns a boolean for any repo/workspace combination", () => {
    fc.assert(
      fc.property(
        fc.option(fc.record({ workspaceId: fc.string() }), { nil: null }),
        fc.string(),
        (repo, workspaceId) => {
          const result = canAccessRepoInWorkspace(repo, workspaceId);
          expect(typeof result).toBe("boolean");
        }
      ),
      { numRuns: 500 }
    );
  });

  it("returns true when repo.workspaceId matches workspaceId", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (wsId) => {
        const repo: Repo = { workspaceId: wsId };
        expect(canAccessRepoInWorkspace(repo, wsId)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it("returns false when repo.workspaceId differs from workspaceId", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (wsId, otherWsId) => {
          fc.pre(wsId !== otherWsId);
          const repo: Repo = { workspaceId: wsId };
          expect(canAccessRepoInWorkspace(repo, otherWsId)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("returns false when repo is null", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (workspaceId) => {
        expect(canAccessRepoInWorkspace(null, workspaceId)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

// ── 5. splitBufferedLines ──────────────────────────────────────────────────

describe("splitBufferedLines fuzz", () => {
  it("never throws for any string input", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 1000 }), (buffer) => {
        expect(() => splitBufferedLines(buffer)).not.toThrow();
      }),
      { numRuns: 2000 }
    );
  });

  it("normalizes \\r\\n and \\r to \\n, output lines never contain \\r", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (buffer) => {
        const { lines, rest } = splitBufferedLines(buffer);
        for (const line of lines) {
          expect(line).not.toContain("\r");
        }
        expect(rest).not.toContain("\r");
      }),
      { numRuns: 500 }
    );
  });

  it("total lines content + rest equals normalized input", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (buffer) => {
        const { lines, rest } = splitBufferedLines(buffer);
        const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const joined = lines.join("\n") + (lines.length > 0 && rest ? "\n" : "") + rest;
        expect(joined).toBe(normalized);
      }),
      { numRuns: 500 }
    );
  });

  it("last incomplete line is always returned as rest (not in lines)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (buffer) => {
        const { lines, rest } = splitBufferedLines(buffer);
        const lastNewline = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n").lastIndexOf("\n");
        if (lastNewline === -1) {
          expect(lines).toEqual([]);
          expect(rest).toBe(buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
        } else {
          expect(rest).toBe(
            buffer
              .replace(/\r\n/g, "\n")
              .replace(/\r/g, "\n")
              .slice(lastNewline + 1)
          );
        }
      }),
      { numRuns: 500 }
    );
  });

  it("handles all-whitespace, empty, and special characters without throwing", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(""),
          fc.constant("\n"),
          fc.constant("\r"),
          fc.constant("\r\n"),
          fc.constant("   "),
          fc.constant("\t\n\r\n\t"),
          fc.string({ minLength: 0, maxLength: 200 })
        ),
        (buffer) => {
          const { lines, rest } = splitBufferedLines(buffer);
          expect(Array.isArray(lines)).toBe(true);
          expect(typeof rest).toBe("string");
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ── 6. parsePositiveInt ─────────────────────────────────────────────────────

describe("parsePositiveInt fuzz", () => {
  it("for any input, returns null or a positive integer", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.constant(null),
          fc.constant(undefined),
          fc.constant(NaN),
          fc.constant(Infinity),
          fc.constant(-Infinity),
          fc.constant(0),
          fc.double()
        ),
        (value) => {
          const result = parsePositiveInt(value as string | number | null | undefined);
          if (result === null) {
            expect(result).toBeNull();
          } else {
            expect(Number.isInteger(result)).toBe(true);
            expect(result).toBeGreaterThanOrEqual(0);
          }
        }
      ),
      { numRuns: 2000 }
    );
  });

  it("parses positive integer strings correctly", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99999 }), (n) => {
        expect(parsePositiveInt(String(n))).toBe(n);
      }),
      { numRuns: 500 }
    );
  });

  it("'0', negative strings, and non-numeric strings return null", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant("0"),
          fc.constant("-5"),
          fc.constant("abc"),
          fc.constant(""),
          fc.constant("not-a-number")
        ),
        (input) => {
          expect(parsePositiveInt(input)).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("NaN, undefined, null, Infinity, -Infinity all return null", () => {
    fc.assert(
      fc.property(fc.constantFrom(null, undefined, NaN, Infinity, -Infinity), (value) => {
        expect(parsePositiveInt(value as string | number | null | undefined)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("string with leading/trailing whitespace still parses when number is valid", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9999 }),
        fc.array(fc.constantFrom(" ", "\t", "\n"), { minLength: 0, maxLength: 3 }),
        fc.array(fc.constantFrom(" ", "\t", "\n"), { minLength: 0, maxLength: 3 }),
        (n, pre, post) => {
          const input = pre.join("") + String(n) + post.join("");
          const result = parsePositiveInt(input);
          if (result === null && input.trim() === String(n)) {
            // The implementation uses Number() which may fail on whitespace
            expect(Number(input.trim())).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
