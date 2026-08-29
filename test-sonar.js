const fs = require('fs');

const content = fs.readFileSync('packages/server/src/auth.test.ts', 'utf-8');

// A quick and dirty check for duplicated blocks
// We know from the error that there's duplication. We can extract common fetch mocking
// into a setup function to reduce duplication.

console.log("Checking duplication in auth.test.ts...");
