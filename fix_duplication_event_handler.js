const fs = require('fs');
const eventHandlerPath = 'packages/server/src/agents/orchestrator/event-handler.test.ts';
let content = fs.readFileSync(eventHandlerPath, 'utf8');

// I made a mistake using replace and inserted describe inside it("handles log event correctly", ...)
content = content.replace(/const onActivity = mock\(\(\) => \{\n\s*describe\("run not found scenarios"[\s\S]*?\}\);\n\s*\}\);/, 'const onActivity = mock(() => {});');

const notFoundTestBlock = `
  describe("run not found scenarios", () => {
    it("handles events when run is missing without crashing", async () => {
      const localMockDb = {
        ...mockDb,
        runs: {
          ...mockDb.runs,
          getById: mock(() => undefined),
          updateCostStats: mock(() => {}),
          updateSessionId: mock(() => {}),
        },
      } as unknown as Db;

      await handleAgentEvent(
        { type: "status", content: "Working..." },
        "run1",
        "task1",
        localMockDb,
        mockHub
      );
      expect(localMockDb.runs.getById).toHaveBeenCalledWith("run1");

      await handleAgentEvent(
        { type: "cost", costStats: { total_tokens: 100, input_tokens: 50, output_tokens: 50 } },
        "run1",
        "task1",
        localMockDb,
        mockHub
      );
      expect(localMockDb.runs.updateCostStats).toHaveBeenCalledWith("run1", {
        total_tokens: 100,
        input_tokens: 50,
        output_tokens: 50,
      });

      await handleAgentEvent(
        { type: "session", sessionId: "sess_123" },
        "run1",
        "task1",
        localMockDb,
        mockHub
      );
      expect(localMockDb.runs.updateSessionId).toHaveBeenCalledWith("run1", "sess_123");
    });
  });
`;

content = content.replace('});\n', `${notFoundTestBlock}\n});\n`);

fs.writeFileSync(eventHandlerPath, content);
