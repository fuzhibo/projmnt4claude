#!/bin/bash
# 批量修复检查点前缀问题

TASKS_DIR=".projmnt4claude/tasks"

# 定义修复规则：将无前缀的描述添加前缀
fix_prefix() {
  local file=$1
  local desc=$2
  local prefix=$3

  # 检查描述是否已包含前缀
  if ! echo "$desc" | grep -qE '^\[(ai review|ai qa|human qa|script)\]'; then
    # 转义特殊字符用于sed
    local escaped_desc=$(echo "$desc" | sed 's/[\/\&]/\\&/g')
    local new_desc="[$prefix] $escaped_desc"

    # 使用临时文件进行替换
    sed -i "s/\"description\": \"$escaped_desc\"/\"description\": \"$new_desc\"/g" "$file"
  fi
}

# 修复任务1: TASK-test-P2-harness-harness-test-wrapper-ts-20260415
echo "Fixing TASK-test-P2-harness-harness-test-wrapper-ts-20260415..."
FILE="$TASKS_DIR/TASK-test-P2-harness-harness-test-wrapper-ts-20260415/meta.json"
if [ -f "$FILE" ]; then
  fix_prefix "$FILE" "为 createHarnessTestContext 编写的测试通过" "ai qa"
  fix_prefix "$FILE" "harness-test-wrapper.ts" "script"
  fix_prefix "$FILE" "src/utils/hd-assembly-line.ts" "script"
  fix_prefix "$FILE" "jest.config.js" "script"
  fix_prefix "$FILE" "创建测试环境辅助工具" "ai review"
  fix_prefix "$FILE" "使用临时目录运行测试" "ai review"
  fix_prefix "$FILE" "实现自动清理机制" "ai review"
  fix_prefix "$FILE" "更新现有测试使用新工具" "ai review"
fi

# 修复任务2: TASK-refactor-P2-problem-harness-command-contains-20260418
echo "Fixing TASK-refactor-P2-problem-harness-command-contains-20260418..."
FILE="$TASKS_DIR/TASK-refactor-P2-problem-harness-command-contains-20260418/meta.json"
if [ -f "$FILE" ]; then
  fix_prefix "$FILE" "Multiple lines with pipeline stage status" "ai review"
  fix_prefix "$FILE" "Multiple lines with task execution logs" "ai review"
  fix_prefix "$FILE" "Multiple lines with retry and error handling" "ai review"
  fix_prefix "$FILE" "Run: bun run src/index.ts headless-harness-design --dry-run" "script"
  fix_prefix "$FILE" "Verify pipeline preview displays in English" "ai qa"
  fix_prefix "$FILE" "Check that all status messages are in English" "ai qa"
fi

# 修复任务3: TASK-refactor-P3-problem-type-definition-files-20260418
echo "Fixing TASK-refactor-P3-problem-type-definition-files-20260418..."
FILE="$TASKS_DIR/TASK-refactor-P3-problem-type-definition-files-20260418/meta.json"
if [ -f "$FILE" ]; then
  fix_prefix "$FILE" "src/types/harness.ts" "script"
  fix_prefix "$FILE" "src/types/decomposition.ts" "script"
  fix_prefix "$FILE" "src/types/task.ts" "script"
  fix_prefix "$FILE" "Check that all comments are in English" "ai qa"
  fix_prefix "$FILE" "Verify TypeScript compilation works" "script"
  fix_prefix "$FILE" "Check IDE tooltips display correctly" "ai qa"
fi

# 修复任务4: TASK-refactor-P1-problem-analyze-command-contains-20260418-2
echo "Fixing TASK-refactor-P1-problem-analyze-command-contains-20260418-2..."
FILE="$TASKS_DIR/TASK-refactor-P1-problem-analyze-command-contains-20260418-2/meta.json"
if [ -f "$FILE" ]; then
  fix_prefix "$FILE" "Line 2539: Check range parameter error" "ai review"
  fix_prefix "$FILE" "Line 3497: Task not found error" "ai review"
  fix_prefix "$FILE" "Multiple lines with analysis results" "ai review"
  fix_prefix "$FILE" "Multiple lines with fix suggestions" "ai review"
  fix_prefix "$FILE" "Run: bun run src/index.ts analyze --quality-check" "script"
  fix_prefix "$FILE" "Run: bun run src/index.ts analyze --fix --yes" "script"
  fix_prefix "$FILE" "Verify all output is in English" "ai qa"
fi

# 修复任务5: TASK-refactor-P1-problem-analyze-command-contains-20260418-1
echo "Fixing TASK-refactor-P1-problem-analyze-command-contains-20260418-1..."
FILE="$TASKS_DIR/TASK-refactor-P1-problem-analyze-command-contains-20260418-1/meta.json"
if [ -f "$FILE" ]; then
  fix_prefix "$FILE" "Line 2539: Check range parameter error" "ai review"
  fix_prefix "$FILE" "Line 3497: Task not found error" "ai review"
  fix_prefix "$FILE" "Multiple lines with analysis results" "ai review"
  fix_prefix "$FILE" "Multiple lines with fix suggestions" "ai review"
  fix_prefix "$FILE" "Run: bun run src/index.ts analyze --quality-check" "script"
  fix_prefix "$FILE" "Run: bun run src/index.ts analyze --fix --yes" "script"
  fix_prefix "$FILE" "Verify all output is in English" "ai qa"
fi

# 修复任务6: TASK-refactor-P3-problem-component-api-files-20260418
echo "Fixing TASK-refactor-P3-problem-component-api-files-20260418..."
FILE="$TASKS_DIR/TASK-refactor-P3-problem-component-api-files-20260418/meta.json"
if [ -f "$FILE" ]; then
  fix_prefix "$FILE" "src/components/LoginButton.tsx" "script"
  fix_prefix "$FILE" "src/pages/Register.tsx" "script"
  fix_prefix "$FILE" "src/api/auth.ts" "script"
  fix_prefix "$FILE" "Check that all UI text is in English" "ai qa"
  fix_prefix "$FILE" "Verify API error messages are in English" "ai qa"
  fix_prefix "$FILE" "Check for any remaining Chinese characters" "ai qa"
fi

# 修复任务7: TASK-refactor-P2-problem-doctor-command-contains-20260418
echo "Fixing TASK-refactor-P2-problem-doctor-command-contains-20260418..."
FILE="$TASKS_DIR/TASK-refactor-P2-problem-doctor-command-contains-20260418/meta.json"
if [ -f "$FILE" ]; then
  fix_prefix "$FILE" "Line 1183: Bug report generation failure error" "ai review"
  fix_prefix "$FILE" "Multiple lines with diagnostic messages" "ai review"
  fix_prefix "$FILE" "Multiple lines with fix suggestions" "ai review"
  fix_prefix "$FILE" "Run: bun run src/index.ts doctor" "script"
  fix_prefix "$FILE" "Run: bun run src/index.ts doctor --bug-report" "script"
  fix_prefix "$FILE" "Verify all output is in English" "ai qa"
fi

# 修复任务8: TASK-refactor-P2-problem-config-command-contains-20260418
echo "Fixing TASK-refactor-P2-problem-config-command-contains-20260418..."
FILE="$TASKS_DIR/TASK-refactor-P2-problem-config-command-contains-20260418/meta.json"
if [ -f "$FILE" ]; then
  fix_prefix "$FILE" "Lines with config get/set error messages" "ai review"
  fix_prefix "$FILE" "Run: bun run src/index.ts config list" "script"
  fix_prefix "$FILE" "Run: bun run src/index.ts config set test.value test" "script"
  fix_prefix "$FILE" "Verify all output is in English" "ai qa"
fi

# 修复任务9: TASK-refactor-P1-problem-command-contains-chinese-20260418
echo "Fixing TASK-refactor-P1-problem-command-contains-chinese-20260418..."
FILE="$TASKS_DIR/TASK-refactor-P1-problem-command-contains-chinese-20260418/meta.json"
if [ -f "$FILE" ]; then
  fix_prefix "$FILE" "Line 3176: Parent task not found error" "ai review"
  fix_prefix "$FILE" "Line 4537: Rename failure error" "ai review"
  fix_prefix "$FILE" "Multiple lines with task operation errors" "ai review"
  fix_prefix "$FILE" "Multiple lines with checkpoint validation messages" "ai review"
  fix_prefix "$FILE" "Run: bun run src/index.ts task list" "script"
  fix_prefix "$FILE" 'Run: bun run src/index.ts task create --title "Test" --type feature' "script"
  fix_prefix "$FILE" "Verify all output is in English" "ai qa"
fi

# 修复任务10: TASK-test-P2-test-20260418
echo "Fixing TASK-test-P2-test-20260418..."
FILE="$TASKS_DIR/TASK-test-P2-test-20260418/meta.json"
if [ -f "$FILE" ]; then
  fix_prefix "$FILE" "test 目标已达成" "ai qa"
  fix_prefix "$FILE" "jest.config.js" "script"
fi

echo "Checkpoint prefix fixes completed!"
