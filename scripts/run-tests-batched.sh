#!/bin/bash
# Test runner that runs basic tests (src/__tests__ only) to avoid OOM with SWC/Jest
# For full test suite, use: npm run test:all

# NOTE: Removed 'set -e' to allow partial failures and continue running remaining batches
# Exit code tracking is handled manually below

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Number of test files per batch
BATCH_SIZE=15

# Track overall success
OVERALL_EXIT=0

# Check if specific test files are provided as arguments
if [ $# -gt 0 ]; then
  echo "Running specified test files: $@"
  npx jest --no-coverage --runInBand --testPathPatterns="$@"
  exit $?
fi

# Get test files from src/__tests__ only (basic tests)
TEST_FILES=$(find src/__tests__ -name "*.test.ts" | sort)
TOTAL=$(echo "$TEST_FILES" | wc -l)

if [ "$TOTAL" -eq 0 ]; then
  echo "No test files found in src/__tests__/"
  exit 0
fi

echo "Running basic tests (src/__tests__ only, $TOTAL files)..."
echo "For full test suite, use: npm run test:all"
echo ""

# Split into batches and run
CURRENT=0
BATCH=()
for file in $TEST_FILES; do
  BATCH+=("$file")
  CURRENT=$((CURRENT + 1))

  if [ $CURRENT -ge $BATCH_SIZE ]; then
    echo "Running batch of $CURRENT tests..."
    timeout 180 npx jest --no-coverage --runInBand "${BATCH[@]}"
    BATCH_EXIT=$?
    if [ $BATCH_EXIT -ne 0 ]; then
      echo "  ⚠️  Batch failed with exit code $BATCH_EXIT, continuing..."
      OVERALL_EXIT=1
    fi
    BATCH=()
    CURRENT=0
  fi
done

# Run remaining tests
if [ ${#BATCH[@]} -gt 0 ]; then
  echo "Running final batch of ${#BATCH[@]} tests..."
  timeout 180 npx jest --no-coverage --runInBand "${BATCH[@]}"
  BATCH_EXIT=$?
  if [ $BATCH_EXIT -ne 0 ]; then
    echo "  ⚠️  Final batch failed with exit code $BATCH_EXIT"
    OVERALL_EXIT=1
  fi
fi

echo ""
if [ $OVERALL_EXIT -eq 0 ]; then
  echo "✅ All $TOTAL basic tests completed!"
else
  echo "❌ Some tests failed. Check output above for details."
fi

exit $OVERALL_EXIT