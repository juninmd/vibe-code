#!/bin/bash
# Check if bun is installed
if ! command -v bun &> /dev/null
then
    echo "bun could not be found. Please install bun."
    exit 1
fi

echo "--- STARTING DIAGNOSTICS ---"

echo ""
echo "--- SHARED TYPECHECK ---"
cd packages/shared && bun run typecheck 2>&1

echo ""
echo "--- SERVER TYPECHECK ---"
cd ../server && bun run typecheck 2>&1

echo ""
echo "--- WEB TYPECHECK ---"
cd ../web && bun run typecheck 2>&1

echo ""
echo "--- BIOME CHECK ---"
cd ../.. && bunx biome check . 2>&1

echo ""
echo "--- END OF DIAGNOSTICS ---"
