const fs = require('fs');

const eventHandlerPath = 'packages/server/src/agents/orchestrator/event-handler.test.ts';
let content = fs.readFileSync(eventHandlerPath, 'utf8');

// Wait... my previous replacement put 'await' inside a mock definition?
// I see it now:
/*
    const onActivity = mock(() => {
      describe("run not found scenarios", () => {
*/

// I need to extract the describe block OUTSIDE of the "handles log event correctly" block completely.

content = content.replace(/const onActivity = mock\(\(\) => \{\n\s*describe\("run not found scenarios"[\s\S]*?\}\);\n\s*\}\);/, 'const onActivity = mock(() => {});');

// The above replace didn't work last time because the first regex in `fix_duplication_event_handler.js` failed to match perfectly.
// Let's rewrite the file clean since we know what it looks like.
