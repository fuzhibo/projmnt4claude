#!/bin/bash
# Test runner that splits tests into batches to avoid OOM with SWC/Jest

set -e

# Number of test files per batch
BATCH_SIZE=25

# Get all test files
TEST_FILES=$(find src/__tests__ -name "*.test.ts" | sort)
TOTAL=$(echo "$TEST_FILES" | wc -l)

# Split into batches and run
CURRENT=0
BATCH=()
for file in $TEST_FILES; do
  BATCH+=("$file")
  CURRENT=$((CURRENT + 1))

  if [ $CURRENT -ge $BATCH_SIZE ]; then
    echo "Running batch of $CURRENT tests..."
    npx jest --no-coverage --runInBand "${BATCH[@]}"
    BATCH=()
    CURRENT=0
  fi
done

# Run remaining tests
if [ ${#BATCH[@]} -gt 0 ]; then
  echo "Running final batch of ${#BATCH[@]} tests..."
  npx jest --no-coverage --runInBand "${BATCH[@]}"
fi

echo "All $TOTAL tests completed!"
