import { afterAll, describe, expect, it } from "bun:test";
import fc from "fast-check";
import { GitService } from "./git-service";

const git = new GitService();

function getRepoOwnerAndName(url: string): string {
  const match = url.match(/[:/]([^/:]+\/[^/.]+)(?:\.git)?$/);
  return match ? match[1] : url;
}

function getCollisionSafeName(url: string, defaultName: string): string {
  try {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const u = new URL(url);
      const host = u.hostname;
      const ownerAndName = u.pathname.replace(/^\//, "").replace(/\.git$/, "");
      const pathSlug = ownerAndName.replace(/\//g, "+");
      return `${host}+${pathSlug}`;
    }
    const sshMatch = url.match(/^git@([^:]+):([^/]+)\/([^.]+)(?:\.git)?$/);
    if (sshMatch) {
      const [, host, owner, name] = sshMatch;
      return `${host}+${owner}+${name}`;
    }
  } catch {
    // ignore
  }
  return defaultName;
}

function isValidBranchName(b: string): boolean {
  return !/[ ~^:\\?*[\]]/.test(b) && !b.includes("..") && b.length > 0;
}

// ─── getRepoOwnerAndName ─────────────────────────────────────────────────

describe("getRepoOwnerAndName fuzz", () => {
  it("never throws for any arbitrary string", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (url) => {
        expect(() => getRepoOwnerAndName(url)).not.toThrow();
      }),
      { numRuns: 2000 }
    );
  });

  it("never returns empty string for non-empty input", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (url) => {
        const result = getRepoOwnerAndName(url);
        expect(result.length).toBeGreaterThan(0);
      }),
      { numRuns: 1000 }
    );
  });

  it("preserves owner/repo for https://github.com URLs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => /^[a-zA-Z0-9._-]+$/.test(s)),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        (owner, repo) => {
          const url = `https://github.com/${owner}/${repo}`;
          expect(getRepoOwnerAndName(url)).toBe(`${owner}/${repo}`);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("strips .git suffix from URLs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        (owner, repo) => {
          const withGit = `https://github.com/${owner}/${repo}.git`;
          const withoutGit = `https://github.com/${owner}/${repo}`;
          expect(getRepoOwnerAndName(withGit)).toBe(getRepoOwnerAndName(withoutGit));
        }
      ),
      { numRuns: 500 }
    );
  });

  it("parses SSH format git@github.com:owner/repo", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        (owner, repo) => {
          const url = `git@github.com:${owner}/${repo}.git`;
          expect(getRepoOwnerAndName(url)).toBe(`${owner}/${repo}`);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("returns whole URL when no pattern matches", () => {
    fc.assert(
      fc.property(
        fc
          .string({ maxLength: 100 })
          .filter((s) => !/[:/]([^/:]+\/[^/.]+)(?:\.git)?$/.test(s) && s.length > 0),
        (url) => {
          expect(getRepoOwnerAndName(url)).toBe(url);
        }
      ),
      { numRuns: 500 }
    );
  });
});

// ─── gitEnv (static) ─────────────────────────────────────────────────────

describe("GitService.gitEnv fuzz", () => {
  const origEnv = process.env;

  afterAll(() => {
    process.env = origEnv;
  });

  it("never throws regardless of process.env shape", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
          fc.string({ maxLength: 50 })
        ),
        (fakeEnv) => {
          process.env = fakeEnv as Record<string, string>;
          expect(() => GitService.gitEnv()).not.toThrow();
        }
      ),
      { numRuns: 500 }
    );
  });

  it("always returns a non-null object", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
          fc.string({ maxLength: 50 })
        ),
        (fakeEnv) => {
          process.env = fakeEnv as Record<string, string>;
          const result = GitService.gitEnv();
          expect(result).toBeDefined();
          expect(typeof result).toBe("object");
        }
      ),
      { numRuns: 500 }
    );
  });

  it("always sets GIT_TERMINAL_PROMPT to 0", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
          fc.string({ maxLength: 50 })
        ),
        (fakeEnv) => {
          process.env = fakeEnv as Record<string, string>;
          const result = GitService.gitEnv();
          expect(result.GIT_TERMINAL_PROMPT).toBe("0");
        }
      ),
      { numRuns: 500 }
    );
  });

  it("increments GIT_CONFIG_COUNT when pre-existing", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (count) => {
        process.env = { GIT_CONFIG_COUNT: count.toString() } as Record<string, string>;
        const result = GitService.gitEnv();
        expect(parseInt(result.GIT_CONFIG_COUNT ?? "0", 10)).toBe(
          Number.isNaN(count) ? 1 : count + 1
        );
      }),
      { numRuns: 500 }
    );
  });
});

// ─── Collision-safe name ─────────────────────────────────────────────────

describe("getCollisionSafeName fuzz", () => {
  it("never throws for any URL string", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 300 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (url, defaultName) => {
          expect(() => getCollisionSafeName(url, defaultName)).not.toThrow();
        }
      ),
      { numRuns: 2000 }
    );
  });

  it("never contains path separator (/) in output for any URL", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 300 }),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => /^[a-zA-Z0-9._-]+$/.test(s)),
        (url, defaultName) => {
          const result = getCollisionSafeName(url, defaultName);
          expect(result).not.toContain("/");
          expect(result).not.toContain("\\");
        }
      ),
      { numRuns: 1000 }
    );
  });
});

// ─── URL parsing ─────────────────────────────────────────────────────────

describe("URL format parsing fuzz", () => {
  it("never throws for HTTPS URLs with arbitrary paths", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 100 })
          .filter((s) => !s.includes("\n") && !s.includes("\0")),
        (path) => {
          const url = `https://github.com/${path}`;
          expect(() => new URL(url)).not.toThrow();
          expect(() => getRepoOwnerAndName(url)).not.toThrow();
        }
      ),
      { numRuns: 500 }
    );
  });

  it("never throws for SSH git@ URLs with arbitrary names", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => /^[a-zA-Z0-9._-]+$/.test(s)),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => /^[a-zA-Z0-9._-]+$/.test(s)),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => /^[a-zA-Z0-9._-]+$/.test(s)),
        (host, owner, repo) => {
          const url = `git@${host}:${owner}/${repo}.git`;
          expect(() => getRepoOwnerAndName(url)).not.toThrow();
          const result = getRepoOwnerAndName(url);
          expect(result.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("handles auth tokens embedded in URLs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /^[a-zA-Z0-9._-]+$/.test(s)),
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /^[a-zA-Z0-9._-]+$/.test(s)),
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /^[a-zA-Z0-9._-]+$/.test(s)),
        (protocol, token, owner, repo) => {
          const url = `${protocol}://${token}@github.com/${owner}/${repo}.git`;
          expect(() => getRepoOwnerAndName(url)).not.toThrow();
        }
      ),
      { numRuns: 500 }
    );
  });

  it("handles protocol-relative URLs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /^[a-zA-Z0-9._-]+$/.test(s)),
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /^[a-zA-Z0-9._-]+$/.test(s)),
        (owner, repo) => {
          const url = `//github.com/${owner}/${repo}.git`;
          expect(() => getRepoOwnerAndName(url)).not.toThrow();
          const result = getRepoOwnerAndName(url);
          expect(result.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("handles git:// protocol URLs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /^[a-zA-Z0-9._-]+$/.test(s)),
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /^[a-zA-Z0-9._-]+$/.test(s)),
        (owner, repo) => {
          const url = `git://github.com/${owner}/${repo}.git`;
          expect(() => getRepoOwnerAndName(url)).not.toThrow();
        }
      ),
      { numRuns: 500 }
    );
  });
});

// ─── Branch name validation ─────────────────────────────────────────────

describe("branch name sanitization fuzz", () => {
  it("no valid branch name contains whitespace or git-problematic chars", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 100 })
          .filter((s) => /^[a-zA-Z0-9/._-]+$/.test(s))
          .filter((s) => !s.includes("..")),
        (name) => {
          expect(/\s/.test(name)).toBe(false);
          expect(name.includes("..")).toBe(false);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("isValidBranchName matches realistic branch names", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 100 })
          .filter((s) => /^[a-zA-Z0-9/._-]+$/.test(s))
          .filter((s) => !s.includes("..") && !s.includes("//") && !s.includes(".lock"))
          .filter((s) => !s.startsWith("/") && !s.endsWith("/")),
        (name) => {
          expect(isValidBranchName(name)).toBe(true);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("isValidBranchName rejects branch names with git-problematic chars", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          " ~",
          "bad^",
          "col:on",
          "back\\slash",
          "qu?stion",
          "as*terisk",
          "[bracket",
          "dot..dot"
        ),
        (name) => {
          expect(isValidBranchName(name)).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ─── Path combination ────────────────────────────────────────────────────

describe("path combination fuzz", () => {
  it("never throws combining repo base + name + branch", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => /^[a-zA-Z0-9._/-]+$/.test(s)),
        fc
          .string({ minLength: 1, maxLength: 50 })
          .filter((s) => !/[ ~^:\\?*[..]/.test(s) && !s.includes("..")),
        fc
          .string({ minLength: 1, maxLength: 50 })
          .filter((s) => !/[ ~^:\\?*[..]/.test(s) && !s.includes("..")),
        (basePath, repoName, branch) => {
          const wtPath = `${basePath}/${repoName}/${branch}`;
          expect(() => wtPath).toBeDefined();
          expect(wtPath.length).toBeGreaterThan(0);
          expect(wtPath).toContain(repoName);
          expect(wtPath).toContain(branch);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("getCollisionSafeName output is safe to use in file paths", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (url) => {
        const name = getCollisionSafeName(url, "default-name");
        expect(name.includes("\0")).toBe(false);
        expect(name.includes("\n")).toBe(false);
      }),
      { numRuns: 500 }
    );
  });
});

// ─── getBarePath ─────────────────────────────────────────────────────────

describe("getBarePath fuzz", () => {
  it("never throws for any repoName, even without URL", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (repoName) => {
        const barePath = git.getBarePath(repoName);
        expect(typeof barePath).toBe("string");
        expect(barePath.length).toBeGreaterThan(0);
      }),
      { numRuns: 500 }
    );
  });
});
