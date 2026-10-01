import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('packages/server/src/agents/engines/opencode.test.ts', 'utf-8');
content = content.replace(/mockImplementation\(\(cmd: string\[\], options\?: any\) => \{/g, 'mockImplementation(((cmd: string[], options?: any) => {')
content = content.replace(/        \}\)\;/g, '        }) as any);');
writeFileSync('packages/server/src/agents/engines/opencode.test.ts', content);
