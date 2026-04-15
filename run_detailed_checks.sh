#!/bin/bash
echo "--- Running typecheck in shared ---"
cd packages/shared && bun run typecheck 2>&1
echo "--- Running typecheck in server ---"
cd ../server && bun run typecheck 2>&1
echo "--- Running typecheck in web ---"
cd ../web && bun run typecheck 2>&1
echo "--- Running biome check ---"
cd ../.. && bunx biome check . 2>&1
