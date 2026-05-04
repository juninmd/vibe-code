const fs = require('fs');

const eventHandlerPath = 'packages/server/src/agents/orchestrator/event-handler.test.ts';
let eventHandlerContent = fs.readFileSync(eventHandlerPath, 'utf8');

eventHandlerContent = eventHandlerContent.replace(
  /it\("handles status event when run is not found", async \(\) => \{\n\s*const event: AgentEvent = \{ type: "status", content: "Working\.\.\." \};\n\s*const localMockDb = \{\n\s*\.\.\.mockDb,\n\s*runs: \{ \.\.\.mockDb\.runs, getById: mock\(\(\) => undefined\) \},\n\s*\} as unknown as Db;\n\s*await handleAgentEvent\(event, "run1", "task1", localMockDb, mockHub\);\n\s*expect\(localMockDb\.runs\.getById\)\.toHaveBeenCalledWith\("run1"\);\n\s*\}\);\n\n\s*it\("handles cost event correctly"/g,
  `it("handles cost event correctly"`
);

eventHandlerContent = eventHandlerContent.replace(
  /it\("handles cost event when run is not found", async \(\) => \{\n\s*const event: AgentEvent = \{\n\s*type: "cost",\n\s*costStats: \{ total_tokens: 100, input_tokens: 50, output_tokens: 50 \},\n\s*\};\n\s*const localMockDb = \{\n\s*\.\.\.mockDb,\n\s*runs: \{ \.\.\.mockDb\.runs, getById: mock\(\(\) => undefined\), updateCostStats: mock\(\(\) => \{\}\) \},\n\s*\} as unknown as Db;\n\s*await handleAgentEvent\(event, "run1", "task1", localMockDb, mockHub\);\n\s*expect\(localMockDb\.runs\.updateCostStats\)\.toHaveBeenCalledWith\("run1", \{\n\s*total_tokens: 100,\n\s*input_tokens: 50,\n\s*output_tokens: 50,\n\s*\}\);\n\s*\}\);\n\n\s*it\("handles session event correctly"/g,
  `it("handles session event correctly"`
);

eventHandlerContent = eventHandlerContent.replace(
  /it\("handles session event when run is not found", async \(\) => \{\n\s*const event: AgentEvent = \{ type: "session", sessionId: "sess_123" \};\n\s*const localMockDb = \{\n\s*\.\.\.mockDb,\n\s*runs: \{ \.\.\.mockDb\.runs, getById: mock\(\(\) => undefined\), updateSessionId: mock\(\(\) => \{\}\) \},\n\s*\} as unknown as Db;\n\s*await handleAgentEvent\(event, "run1", "task1", localMockDb, mockHub\);\n\s*expect\(localMockDb\.runs\.updateSessionId\)\.toHaveBeenCalledWith\("run1", "sess_123"\);\n\s*\}\);\n\n\s*it\("handles tool_use event correctly"/g,
  `it("handles tool_use event correctly"`
);

// We'll write a single parameterized test to cover all 'not found' scenarios for event handler to reduce duplication
const notFoundTest = `
  describe("run not found scenarios", () => {
    it("handles events when run is missing without crashing", async () => {
      const localMockDb = { ...mockDb, runs: { ...mockDb.runs, getById: mock(() => undefined), updateCostStats: mock(() => {}), updateSessionId: mock(() => {}) } } as unknown as Db;

      await handleAgentEvent({ type: "status", content: "Working..." }, "run1", "task1", localMockDb, mockHub);
      expect(localMockDb.runs.getById).toHaveBeenCalledWith("run1");

      await handleAgentEvent({ type: "cost", costStats: { total_tokens: 100, input_tokens: 50, output_tokens: 50 } }, "run1", "task1", localMockDb, mockHub);
      expect(localMockDb.runs.updateCostStats).toHaveBeenCalledWith("run1", { total_tokens: 100, input_tokens: 50, output_tokens: 50 });

      await handleAgentEvent({ type: "session", sessionId: "sess_123" }, "run1", "task1", localMockDb, mockHub);
      expect(localMockDb.runs.updateSessionId).toHaveBeenCalledWith("run1", "sess_123");
    });
  });
`;

eventHandlerContent = eventHandlerContent.replace('});\n', `${notFoundTest}\n});\n`);

fs.writeFileSync(eventHandlerPath, eventHandlerContent);
