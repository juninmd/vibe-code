const fs = require('fs');

const heartbeatPath = 'packages/server/src/agents/engines/heartbeat.test.ts';
let content = fs.readFileSync(heartbeatPath, 'utf8');
content = content.replace(
  'import { describe, expect, it } from "bun:test";',
  'import { afterEach, beforeEach, describe, expect, it } from "bun:test";'
);
fs.writeFileSync(heartbeatPath, content);
