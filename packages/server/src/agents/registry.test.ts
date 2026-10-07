import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { AgentEngine } from "./engine";
import { EngineRegistry } from "./registry";

class MockEngine implements AgentEngine {
  name: string;
  displayName: string;
  binaryName?: string;
  available: boolean = true;
  version: string | null = "1.0.0";
  setupIssue: string | null = null;
  models: string[] = ["model-1", "model-free"];
  events: any[] = [];

  constructor(name: string, binaryName?: string) {
    this.name = name;
    this.displayName = `${name} Engine`;
    if (binaryName) this.binaryName = binaryName;
  }

  async isAvailable() {
    return this.available;
  }
  async getVersion() {
    return this.version;
  }
  async getSetupIssue() {
    return this.setupIssue;
  }
  async listModels() {
    return this.models;
  }
  async *execute() {
    yield* this.events;
  }
  abort() {
    return true;
  }
  sendInput() {
    return true;
  }
}

describe("EngineRegistry", () => {
  let registry: EngineRegistry;

  beforeEach(() => {
    registry = new EngineRegistry();
    // Clear out default ones to test precisely
    (registry as any).engines.clear();
  });

  afterEach(() => {
    mock.restore();
  });

  it("register and get", () => {
    const engine = new MockEngine("test-engine");
    registry.register(engine);
    expect(registry.get("test-engine")).toBe(engine);
    expect(registry.get("unknown")).toBeUndefined();
  });

  it("getFirstAvailable", async () => {
    const e1 = new MockEngine("e1");
    e1.available = false;
    const e2 = new MockEngine("e2");
    e2.available = true;

    registry.register(e1);
    registry.register(e2);

    expect(await registry.getFirstAvailable()).toBe(e2);

    e2.available = false;
    expect(await registry.getFirstAvailable()).toBeUndefined();
  });

  describe("listEngines", () => {
    it("handles timeout for isAvailable", async () => {
      const slowEngine = new MockEngine("slow");
      // Replace the global setTimeout temporarily to trigger it immediately
      const origSetTimeout = global.setTimeout;
      (global as any).setTimeout = ((fn: any) => fn()) as any;

      slowEngine.isAvailable = () => new Promise((r) => origSetTimeout(() => r(true), 20000));
      registry.register(slowEngine);

      const results = await registry.listEngines();
      expect(results.length).toBe(1);
      expect(results[0].available).toBe(false);

      global.setTimeout = origSetTimeout;
    });

    it("uses binaryName for fast check if provided", async () => {
      const e = new MockEngine("fast", "my-fake-bin");
      spyOn(Bun, "which").mockReturnValue(null);
      registry.register(e);

      const results = await registry.listEngines();
      expect(results[0].available).toBe(false);

      spyOn(Bun, "which").mockReturnValue("/usr/bin/my-fake-bin");
      const results2 = await registry.listEngines();
      expect(results2[0].available).toBe(true);
    });

    it("caches versions and returns null immediately while fetching", async () => {
      const e = new MockEngine("cached");
      let versionCalled = 0;
      e.getVersion = async () => {
        versionCalled++;
        await Bun.sleep(10);
        return "2.0";
      };
      registry.register(e);

      // First call - should trigger fetch but return null immediately
      const r1 = await registry.listEngines();
      expect(r1[0].version).toBeNull();
      expect(versionCalled).toBe(1);

      // Wait for fetch to complete
      await Bun.sleep(20);

      // Second call - should return cached version and NOT trigger fetch again
      const r2 = await registry.listEngines();
      expect(r2[0].version).toBe("2.0");
      expect(versionCalled).toBe(1);
    });

    it("counts active runs", async () => {
      const e1 = new MockEngine("e1");
      const e2 = new MockEngine("e2");
      registry.register(e1);
      registry.register(e2);

      const activeRuns = new Map([
        ["run1", "e1"],
        ["run2", "e1"],
        ["run3", "e3"],
      ]);
      const results = await registry.listEngines(activeRuns);

      const resE1 = results.find((r) => r.name === "e1")!;
      const resE2 = results.find((r) => r.name === "e2")!;

      expect(resE1.activeRuns).toBe(2);
      expect(resE2.activeRuns).toBe(0);
    });
  });

  describe("listModels", () => {
    it("returns models for registered engine", async () => {
      const e = new MockEngine("test");
      registry.register(e);
      expect(await registry.listModels("test")).toEqual(["model-1", "model-free"]);
    });

    it("returns empty array for unknown engine", async () => {
      expect(await registry.listModels("unknown")).toEqual([]);
    });
  });

  describe("getDefaultFreeModel", () => {
    it("returns free model if found", async () => {
      const e = new MockEngine("test");
      registry.register(e);
      expect(await registry.getDefaultFreeModel("test")).toBe("model-free");
    });

    it("returns null if no free model found", async () => {
      const e = new MockEngine("test");
      e.models = ["pro-1", "pro-2"];
      registry.register(e);
      expect(await registry.getDefaultFreeModel("test")).toBeNull();
    });

    it("returns null for unknown engine", async () => {
      expect(await registry.getDefaultFreeModel("unknown")).toBeNull();
    });

    it("returns null if listModels throws", async () => {
      const e = new MockEngine("test");
      e.listModels = async () => {
        throw new Error("API down");
      };
      registry.register(e);
      expect(await registry.getDefaultFreeModel("test")).toBeNull();
    });
  });
});
