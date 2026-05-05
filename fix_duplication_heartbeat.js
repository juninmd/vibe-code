const fs = require('fs');
const heartbeatPath = 'packages/server/src/agents/engines/heartbeat.test.ts';
let heartbeatContent = fs.readFileSync(heartbeatPath, 'utf8');

heartbeatContent = heartbeatContent.replace(
  /it\("returns default 30000 when env not set", \(\) => \{\n\s*const old = process\.env\.VIBE_CODE_HEARTBEAT_MS;\n\s*delete process\.env\.VIBE_CODE_HEARTBEAT_MS;\n\s*expect\(getHeartbeatIntervalMs\(\)\)\.toBe\(30_000\);\n\s*if \(old !== undefined\) process\.env\.VIBE_CODE_HEARTBEAT_MS = old;\n\s*\}\);\n\n\s*it\("returns env value if set", \(\) => \{\n\s*const old = process\.env\.VIBE_CODE_HEARTBEAT_MS;\n\s*process\.env\.VIBE_CODE_HEARTBEAT_MS = "5000";\n\s*expect\(getHeartbeatIntervalMs\(\)\)\.toBe\(5000\);\n\s*if \(old !== undefined\) \{\n\s*process\.env\.VIBE_CODE_HEARTBEAT_MS = old;\n\s*\} else \{\n\s*delete process\.env\.VIBE_CODE_HEARTBEAT_MS;\n\s*\}\n\s*\}\);/g,
  `
    let oldEnv: string | undefined;

    beforeEach(() => {
      oldEnv = process.env.VIBE_CODE_HEARTBEAT_MS;
    });

    afterEach(() => {
      if (oldEnv !== undefined) {
        process.env.VIBE_CODE_HEARTBEAT_MS = oldEnv;
      } else {
        delete process.env.VIBE_CODE_HEARTBEAT_MS;
      }
    });

    it("returns default 30000 when env not set", () => {
      delete process.env.VIBE_CODE_HEARTBEAT_MS;
      expect(getHeartbeatIntervalMs()).toBe(30_000);
    });

    it("returns env value if set", () => {
      process.env.VIBE_CODE_HEARTBEAT_MS = "5000";
      expect(getHeartbeatIntervalMs()).toBe(5000);
    });
  `
);
fs.writeFileSync(heartbeatPath, heartbeatContent);
