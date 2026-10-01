const fs = require('fs');
const file1 = 'src/agents/engines/reviewer.test.ts';
const file2 = 'src/agents/orchestrator/review.test.ts';

let code1 = fs.readFileSync(file1, 'utf8');
code1 = code1.replace(/test\.skip/g, 'test');
fs.writeFileSync(file1, code1);

let code2 = fs.readFileSync(file2, 'utf8');
code2 = code2.replace(/test\.skip/g, 'test');
fs.writeFileSync(file2, code2);
