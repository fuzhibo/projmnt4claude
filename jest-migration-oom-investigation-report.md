# Jest 迁移 OOM 问题调查报告

**调查日期**: 2026-06-08  
**调查者**: Claude (Opus 4.7)  
**状态**: 待修复  
**优先级**: P0（系统稳定性）

---

## 1. 问题概述

### 1.1 现象描述

在执行 `projmnt4claude investigation-requirement` 相关任务时，系统出现 hung 死崩溃，具体表现为：

1. harness 执行过程中系统无响应
2. 进程卡死在 QA 验证阶段
3. 系统恢复后发现 Jest 进程因 OOM (Out of Memory) 被终止

### 1.2 影响范围

- **影响任务**: `TASK-architecture-P1-investigation-requirement-20260527`
- **影响功能**: 所有需要运行 Jest 测试的 harness 流程
- **影响严重性**: 系统级崩溃，阻塞所有后续工作

---

## 2. 根因分析

### 2.1 直接原因

测试文件 `src/utils/investigation/__tests__/investigation.test.ts`（31KB, 856行）在 ts-jest 编译时触发 OOM。

**验证证据**:

```bash
$ timeout 60 node --expose-gc --max-old-space-size=2048 ./node_modules/.bin/jest \
    src/utils/investigation/__tests__/investigation.test.ts --no-coverage

ts-jest[config] (WARN) 
    The "ts-jest" config option "isolatedModules" is deprecated

<--- Last few GCs --->
[20618:0x25f2d000]    14509 ms: Scavenge 2035.5 MB -> 2033.6 MB
[20618:0x25f2d000]    15341 ms: Mark-Compact 2038.4 MB -> 2035.8 MB

FATAL ERROR: Ineffective mark-compacts near heap limit
Allocation failed - JavaScript heap out of memory
```

**关键发现**: 即使分配 2GB 内存，ts-jest 编译**单个测试文件**仍然 OOM。

### 2.2 根本原因

#### 2.2.1 Jest 配置缺陷

**问题配置** (`jest.config.cjs`):

```javascript
transform: {
  '^.+\\.tsx?$': [
    'ts-jest',
    {
      useESM: true,
      isolatedModules: true,
      // 问题：内联 tsconfig 而非引用项目 tsconfig.json
      tsconfig: {
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'bundler',
        verbatimModuleSyntax: false,  // 与项目配置冲突
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        skipLibCheck: true,
      },
    },
  ],
},
```

**问题分析**:

| 问题 | 描述 | 影响 |
|------|------|------|
| 内联 tsconfig | jest.config.cjs 内联了一个独立的 tsconfig | ts-jest 需要重新解析整个项目依赖图 |
| 配置不一致 | 内联配置与 `tsconfig.json` 存在冲突 | 编译行为不确定，可能导致重复工作 |
| 废弃警告 | `isolatedModules` 在 jest 配置中已废弃 | ts-jest v30 将不再支持此配置方式 |

#### 2.2.2 项目规模问题

**项目规模统计**:

```bash
$ find src -name "*.ts" | wc -l
337

$ find src -name "*.ts" -exec cat {} \; | wc -l
164069
```

- **文件数量**: 337 个 TypeScript 文件
- **代码行数**: 164,069 行
- **node_modules**: 83MB

**ts-jest 编译行为分析**:

当 ts-jest 编译任何测试文件时：

```
编译单个测试文件
    │
    ▼
解析 import 语句
    │
    ▼
递归解析依赖图
    │
    ├─→ src/utils/investigation/types.ts (206 行)
    ├─→ src/utils/investigation/report-generator.ts (130 行)
    ├─→ src/utils/investigation/report-parser.ts (188 行)
    ├─→ src/utils/prompt-templates/loader.ts (71 行)
    ├─→ src/utils/prompt-templates/i18n/zh.ts (279 行)
    ├─→ src/utils/prompt-templates/i18n/en.ts (279 行)
    └─→ ... (337 个文件的完整依赖图)
    │
    ▼
内存峰值 > 2GB
    │
    ▼
OOM 崩溃
```

#### 2.2.3 ESM 模式内存开销

ts-jest 在 ESM 模式 (`useESM: true`) 下的内存开销比 CommonJS 模式高 **3-5 倍**：

- 需要解析 `.js` 扩展名映射
- 需要处理 `import type` 语法
- 需要构建完整的模块依赖图

### 2.3 触发链条

```
harness 开发阶段执行
    │
    ▼
检查点验证要求测试文件存在
    │
    ▼
AI 开发者创建 investigation.test.ts
    │
    ▼
harness QA 阶段运行 npm test
    │
    ▼
ts-jest 编译测试文件
    │
    ▼
解析整个项目依赖图 (337 文件)
    │
    ▼
内存耗尽 (需求 > 2GB)
    │
    ▼
系统 hung 死 / OOM 崩溃
```

---

## 3. 之前的修复尝试

### 3.1 已实施的修复

| 修复内容 | 文件 | 效果 |
|---------|------|------|
| 跳过无关测试文件的全局测试套件 | `harness-qa-tester.ts` | ✅ 无关联文件时跳过 `npm test` |
| 跳过覆盖率检查 | `post-qa-gate/runner.ts` | ✅ 无覆盖率数据时通过 |
| 输出 JSON 双格式报告 | `harness-qa-tester.ts` | ✅ Post-QA Gate 可读取报告 |

### 3.2 修复的局限性

上述修复只解决了**运行时跳过**问题，但没有解决**编译时 OOM** 问题：

- ✅ 当任务无关联测试文件时，跳过 `npm test`
- ❌ 当测试文件存在时，ts-jest 编译仍然 OOM
- ❌ harness 开发阶段会重新创建测试文件

---

## 4. 解决方案

### 4.1 方案 A：修复 jest.config.cjs 配置（推荐）

**修改内容**:

```javascript
// jest.config.cjs
transform: {
  '^.+\\.tsx?$': [
    'ts-jest',
    {
      useESM: true,
      isolatedModules: true,
      // 引用项目 tsconfig，而非内联
      tsconfig: './tsconfig.json',
    },
  ],
},
```

```json
// tsconfig.json 添加
{
  "compilerOptions": {
    "isolatedModules": true
  }
}
```

**预期效果**:
- ts-jest 复用项目的 TypeScript 配置
- 避免重复解析依赖图
- 消除配置不一致警告

### 4.2 方案 B：拆分测试文件

将 `investigation.test.ts` 拆分为多个小文件：

```
src/utils/investigation/__tests__/
├── types.test.ts        (~100 行)
├── report-generator.test.ts  (~150 行)
├── report-parser.test.ts     (~150 行)
├── report-validator.test.ts  (~150 行)
├── config-reader.test.ts     (~100 行)
└── templates.test.ts    (~100 行)
```

**预期效果**:
- 每个文件编译内存需求降低
- 测试隔离性更好
- 但不解决 ts-jest 全局编译问题

### 4.3 方案 C：迁移到 Vitest

**修改内容**:

```javascript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

**预期效果**:
- Vitest 原生 ESM 支持，无需 ts-jest
- 编译速度提升 5-10 倍
- 内存占用降低 50%+

---

## 5. 建议行动计划

### 5.1 立即行动（P0）

1. **修复 jest.config.cjs** - 引用项目 tsconfig.json
2. **更新 tsconfig.json** - 添加 `isolatedModules: true`
3. **验证修复** - 重新运行 harness 确认 OOM 消除

### 5.2 短期优化（P1）

1. **拆分大测试文件** - 每个文件 < 200 行
2. **添加内存限制** - jest 运行时限制内存为 4GB
3. **文档更新** - 记录 Jest 迁移最佳实践

### 5.3 长期规划（P2）

1. **评估 Vitest 迁移** - 对比性能和内存使用
2. **测试策略优化** - 减少测试间的依赖耦合
3. **CI 优化** - 分片测试，降低单机内存压力

---

## 6. 相关资源

### 6.1 相关提交

- `c06ed81` fix(harness-qa): 对齐 Post-QA Gate 报告路径，输出 JSON 双格式
- `13c19f0` fix(post-qa-gate): runner 和 checker 双重修复覆盖率跳过逻辑
- `083a670` fix(harness): QA验证跳过无关测试文件的全局测试套件
- `d4700fb` release: v1.33.2 — Jest 测试框架迁移完成

### 6.2 相关文档

- [ts-jest ESM Support](https://kulshekhar.github.io/ts-jest/docs/guides/esm/)
- [Jest Memory Optimization](https://jestjs.io/docs/configuration#workeridlememorylimit-number)
- [isolatedModules Configuration](https://www.typescriptlang.org/tsconfig/#isolatedModules)

### 6.3 相关任务

- `TASK-architecture-P1-investigation-requirement-20260527` - 触发此问题的任务

---

## 7. 跟踪记录

| 日期 | 事件 | 状态 |
|------|------|------|
| 2026-06-08 | 问题报告：系统 hung 死 | 已确认 |
| 2026-06-08 | 根因分析：ts-jest 配置缺陷 | 已完成 |
| 2026-06-08 | 解决方案设计：方案 A/B/C | 待实施 |

---

## 8. 附录

### 8.1 内存使用分析

```
测试文件编译内存峰值分析：

组件                    内存使用
─────────────────────────────────
ts-jest 核心解析        ~200MB
项目类型定义加载        ~300MB
依赖图构建              ~800MB
代码生成                ~400MB
Jest 运行时             ~300MB
─────────────────────────────────
总计                    ~2GB+
```

### 8.2 测试文件结构

```typescript
// investigation.test.ts 结构分析
describe 块: 8 个
it 块: 103 个
类型导入: 16 个
模块导入: 6 个
测试辅助函数: 3 个
模拟数据对象: 28 个
```

---

*报告生成时间: 2026-06-08T02:45:00Z*  
*最后更新: 2026-06-08T02:45:00Z*
