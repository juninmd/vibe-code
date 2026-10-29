import { describe, expect, it, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { EngineRegistry } from "./registry";

describe("EngineRegistry", () => {
  const registry = new EngineRegistry();

  describe("session resume capability", () => {
    it("reports engines that honor resumeSessionId and report the session id", () => {
      expect(registry.isResumable("opencode")).toBe(true);
      expect(registry.isResumable("acpx")).toBe(true);
    });

    it("does not claim resume support for engines that ignore it or never report a session", () => {
      // claude-code runs `claude acp -p` and never reads the resume option.
      expect(registry.isResumable("claude-code")).toBe(false);
      // These pass --session/--resume but emit no session id, so nothing to resume.
      expect(registry.isResumable("codex")).toBe(false);
      expect(registry.isResumable("gemini")).toBe(false);
      expect(registry.isResumable("missing-engine")).toBe(false);
    });
  });

  describe("get", () => {
    it("returns an engine by name", () => {
      const engine = registry.get("claude-code");
      expect(engine).toBeDefined();
      expect(engine?.name).toBe("claude-code");
    });

    it("returns undefined for an unknown engine", () => {
      expect(registry.get("unknown-engine")).toBeUndefined();
    });
  });

  describe("getFirstAvailable", () => {
    it("returns the first engine that is available", async () => {
      // Create a test registry to mock availability
      const testRegistry = new EngineRegistry();

      const mockEngine1 = { name: "eng1", isAvailable: async () => false } as any;
      const mockEngine2 = { name: "eng2", isAvailable: async () => true } as any;
      const mockEngine3 = { name: "eng3", isAvailable: async () => true } as any;

      testRegistry.register(mockEngine1);
      testRegistry.register(mockEngine2);
      testRegistry.register(mockEngine3);

      const available = await testRegistry.getFirstAvailable();
      expect(available).toBe(mockEngine2);
    });

    it("returns undefined if no engines are available", async () => {
      const testRegistry = new EngineRegistry();
      const mockEngine1 = { name: "eng1", isAvailable: async () => false } as any;
      testRegistry.register(mockEngine1);

      const available = await testRegistry.getFirstAvailable();
      expect(available).toBeUndefined();
    });
  });

  describe("listModels", () => {
    it("returns models for an engine", async () => {
      const testRegistry = new EngineRegistry();
      const mockEngine = { name: "test-eng", listModels: async () => ["model1", "model2"] } as any;
      testRegistry.register(mockEngine);

      const models = await testRegistry.listModels("test-eng");
      expect(models).toEqual(["model1", "model2"]);
    });

    it("returns empty array for an unknown engine", async () => {
      const models = await registry.listModels("unknown-engine");
      expect(models).toEqual([]);
    });
  });

  describe("getDefaultFreeModel", () => {
    it("returns the first free model available", async () => {
      const testRegistry = new EngineRegistry();
      const mockEngine = { name: "test-eng", listModels: async () => ["model1", "model-free", "another"] } as any;
      testRegistry.register(mockEngine);

      const model = await testRegistry.getDefaultFreeModel("test-eng");
      expect(model).toBe("model-free");
    });

    it("returns null if no free model is found", async () => {
      const testRegistry = new EngineRegistry();
      const mockEngine = { name: "test-eng", listModels: async () => ["model1", "another"] } as any;
      testRegistry.register(mockEngine);

      const model = await testRegistry.getDefaultFreeModel("test-eng");
      expect(model).toBeNull();
    });

    it("returns null for an unknown engine", async () => {
      const model = await registry.getDefaultFreeModel("unknown-engine");
      expect(model).toBeNull();
    });

    it("returns null if listModels throws", async () => {
      const testRegistry = new EngineRegistry();
      const mockEngine = { name: "test-eng", listModels: async () => { throw new Error("failed"); } } as any;
      testRegistry.register(mockEngine);

      const model = await testRegistry.getDefaultFreeModel("test-eng");
      expect(model).toBeNull();
    });
  });

  describe("listEngines", () => {
    let mockWhich: ReturnType<typeof spyOn>;

    beforeEach(() => {
      mockWhich = spyOn(Bun, "which").mockReturnValue(null);
    });

    afterEach(() => {
      mockWhich.mockRestore();
    });

    it("lists engines and resolves availability, setup issue, and version", async () => {
      const testRegistry = new EngineRegistry();

      const mockEngine = {
        name: "test-eng",
        displayName: "Test Engine",
        binaryName: "test-bin",
        isAvailable: async () => true,
        getVersion: async () => "1.0.0",
        getSetupIssue: async () => "no issue",
        supportsResume: true,
      } as any;

      testRegistry.register(mockEngine);
      mockWhich.mockReturnValue("/path/to/test-bin" as any);

      const activeRuns = new Map([["run1", "test-eng"], ["run2", "other-eng"], ["run3", "test-eng"]]);

      const list = await testRegistry.listEngines(activeRuns);
      expect(list.length).toBeGreaterThan(0);

      const engInfo = list.find(e => e.name === "test-eng");
      expect(engInfo).toBeDefined();
      expect(engInfo?.displayName).toBe("Test Engine");
      expect(engInfo?.available).toBe(true);
      // The first call returns null for version because it's fetched in background
      expect(engInfo?.version).toBeNull();
      expect(engInfo?.setupIssue).toBe("no issue");
      expect(engInfo?.activeRuns).toBe(2);
      expect(engInfo?.supportsResume).toBe(true);

      // Wait a tick for the background fetch to resolve
      await new Promise(r => setTimeout(r, 0));

      // Second call should return cached version
      const list2 = await testRegistry.listEngines();
      const engInfo2 = list2.find(e => e.name === "test-eng");
      expect(engInfo2?.version).toBe("1.0.0");
    });

    it("handles fallback to isAvailable if binaryName is not present", async () => {
      const testRegistry = new EngineRegistry();
      const mockEngine = {
        name: "test-eng-2",
        displayName: "Test Engine 2",
        isAvailable: async () => true,
        supportsResume: false,
      } as any;

      testRegistry.register(mockEngine);

      const list = await testRegistry.listEngines();
      const engInfo = list.find(e => e.name === "test-eng-2");
      expect(engInfo?.available).toBe(true);
    });

    it("handles isAvailable throwing by resolving to false", async () => {
      const testRegistry = new EngineRegistry();
      const mockEngine = {
        name: "test-eng-3",
        displayName: "Test Engine 3",
        isAvailable: async () => { throw new Error("failed"); },
      } as any;

      testRegistry.register(mockEngine);

      const list = await testRegistry.listEngines();
      const engInfo = list.find(e => e.name === "test-eng-3");
      expect(engInfo?.available).toBe(false);
    });

    it("handles missing getVersion and getSetupIssue methods gracefully", async () => {
      const testRegistry = new EngineRegistry();
      const mockEngine = {
        name: "test-eng-4",
        displayName: "Test Engine 4",
        binaryName: "test-bin",
        isAvailable: async () => true,
      } as any;

      testRegistry.register(mockEngine);
      mockWhich.mockReturnValue("/path/to/test-bin" as any);

      const list = await testRegistry.listEngines();
      const engInfo = list.find(e => e.name === "test-eng-4");
      expect(engInfo?.version).toBeNull();
      expect(engInfo?.setupIssue).toBeNull();
    });

    it("handles getVersion and getSetupIssue throwing errors", async () => {
      const testRegistry = new EngineRegistry();
      const mockEngine = {
        name: "test-eng-5",
        displayName: "Test Engine 5",
        binaryName: "test-bin",
        isAvailable: async () => true,
        getVersion: async () => { throw new Error("failed"); },
        getSetupIssue: async () => { throw new Error("failed"); },
      } as any;

      testRegistry.register(mockEngine);
      mockWhich.mockReturnValue("/path/to/test-bin" as any);

      const list = await testRegistry.listEngines();
      const engInfo = list.find(e => e.name === "test-eng-5");
      expect(engInfo?.setupIssue).toBeNull();

      await new Promise(r => setTimeout(r, 0));

      const list2 = await testRegistry.listEngines();
      const engInfo2 = list2.find(e => e.name === "test-eng-5");
      expect(engInfo2?.version).toBeNull();
    });
  });
});
