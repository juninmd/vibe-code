#!/bin/bash
echo "--- RUNNING TYPECHECK ---"
bun run typecheck > typecheck_output.txt 2>&1
TYPECHECK_STATUS=$?
echo "TYPECHECK_EXIT_CODE=$TYPECHECK_STATUS" > health_summary.txt

echo "--- RUNNING BUILD ---"
bun run build > build_output.txt 2>&1
BUILD_STATUS=$?
echo "BUILD_EXIT_CODE=$BUILD_STATUS" >> health_summary.txt

echo "--- RUNNING TEST ---"
bun run test > test_output.txt 2>&1
TEST_STATUS=$?
echo "TEST_EXIT_CODE=$TEST_STATUS" >> health_summary.txt

if [ $TYPECHECK_STATUS -ne 0 ] || [ $BUILD_STATUS -ne 0 ] || [ $TEST_STATUS -ne 0 ]; then
  echo "--- RUNNING SUB-PACKAGE TESTS ---"
  (cd packages/server && bun test src) > server_test_output.txt 2>&1
  echo "SERVER_TEST_EXIT_CODE=$?" >> health_summary.txt
  (cd packages/web && bun run test) > web_test_output.txt 2>&1
  echo "WEB_TEST_EXIT_CODE=$?" >> health_summary.txt
fi
