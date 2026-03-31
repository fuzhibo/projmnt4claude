---
name: build-release
description: |
  Build and release management for projmnt4claude project. Use this skill when:
  - User wants to build the project
  - User wants to release a new version
  - User wants to sync to marketplace
  - User mentions version numbers, version bump, or release
  - User asks how to publish or deploy the plugin
  - User encounters version mismatch issues

  IMPORTANT: Always use this skill when the user mentions "release", "version", "build", "publish", or "marketplace sync".
---

# Build and Release Management

## The Core Principle

**NEVER manually edit version numbers.** Always use the version management scripts.

The version number exists in **FOUR** files and must stay synchronized:
- `package.json` - npm package version
- `.claude-plugin/plugin.json` - Claude plugin version
- `.claude-plugin/marketplace.json` - Plugin marketplace metadata
- `marketplace.json` (root) - **Claude Code reads this file for marketplace version**

If these diverge, marketplace will show wrong versions and updates will fail.

## Why This Matters

Manual version edits cause:
1. Version mismatch between package.json and plugin.json
2. Marketplace showing stale versions
3. `/plugins update` failures
4. Cache corruption requiring reinstall

## Version Number System

```
MAJOR.MINOR.PATCH (e.g., 1.2.3)

PATCH: Bug fixes, minor improvements (1.2.3 → 1.2.4)
MINOR: New features, backward compatible (1.2.3 → 1.3.0)
MAJOR: Breaking changes (1.2.3 → 2.0.0)
```

## Commands Reference

### Version Bumping

```bash
bun run version:patch   # Increment PATCH (bug fixes)
bun run version:minor   # Increment MINOR (new features)
bun run version:major   # Increment MAJOR (breaking changes)
```

**What version-bump.sh does:**
1. Reads current version from `.claude-plugin/plugin.json`
2. Increments version number
3. Updates ALL FOUR files:
   - `package.json`
   - `.claude-plugin/plugin.json`
   - `.claude-plugin/marketplace.json`
   - `marketplace.json` (root - Claude Code reads this!)

### Building

```bash
bun run build
```

**Output:** `dist/projmnt4claude.js`

### Release (Version + Build + Sync)

```bash
bun run release:patch   # Patch bump + build + marketplace sync
bun run release:minor   # Minor bump + build + marketplace sync
bun run release:major   # Major bump + build + marketplace sync
```

**注意:** `release:*` 命令会自动完成版本递增、构建和同步三步操作。

### Marketplace Sync (仅同步，不递增版本)

```bash
bun run sync-testmarketplace
```

**Sync destination:** `~/claude-marketplace/plugins/projmnt4claude/` (测试环境)

**重要：**
- `sync-testmarketplace` 只同步文件，不再自动递增版本
- 版本递增由 `version:patch/minor/major` 或 `release:patch/minor/major` 完成
- 这只是同步到本地测试 marketplace，用于开发验证
- 生产环境需要通过正常的插件安装流程 (`/plugins install`) 来安装

## ⚠️ 重要规则

### 不要推送
**此技能只负责本地提交，不执行 `git push`。** 推送由用户手动完成。

### 不要修改远程仓库地址
**永远不要修改 git remote URL。** 保持使用 HTTPS：
- `origin https://github.com/fuzhibo/projmnt4claude.git`

如果推送失败需要认证，提醒用户手动执行 `git push`。

## Release Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    RELEASE WORKFLOW                         │
├─────────────────────────────────────────────────────────────┤
│  1. 开发 & 测试                                              │
│     └─ bun run build                                        │
│     └─ 本地验证                                              │
│                                                             │
│  2. 发布 (版本递增 + 构建 + 同步 + 提交)                       │
│     └─ bun run release:patch                                │
│     └─ git add . && git commit -m "release: v1.x.x"         │
│     └─ ⚠️ 不执行 git push                                   │
│                                                             │
│  3. 在测试环境验证                                           │
│     └─ claude /plugins install projmnt4claude               │
│     └─ (从测试 marketplace 安装)                             │
│                                                             │
│  4. 用户手动推送到生产                                        │
│     └─ git push (用户自行执行)                               │
│     └─ 用户通过 /plugins install 安装                        │
└─────────────────────────────────────────────────────────────┘
```

## Correct Workflow

### For Bug Fixes (PATCH)

```bash
git commit -m "fix: description"
bun run release:patch  # 版本递增 + 构建 + 同步
git add . && git commit -m "release: v1.2.4"
# ⚠️ 不执行 git push，由用户手动推送
```

### For New Features (MINOR)

```bash
git commit -m "feat: description"
bun run release:minor  # 版本递增 + 构建 + 同步
git add . && git commit -m "release: v1.3.0"
# ⚠️ 不执行 git push，由用户手动推送
```

### For Breaking Changes (MAJOR)

```bash
git commit -m "feat!: description"
bun run release:major  # 版本递增 + 构建 + 同步
git add . && git commit -m "release: v2.0.0"
# ⚠️ 不执行 git push，由用户手动推送
```

## Common Mistakes

### ❌ NEVER

```bash
# Manual version edit - WRONG
vim package.json
sed -i 's/1.2.3/1.2.4/' package.json
```

### ✅ ALWAYS

```bash
# Use version scripts - CORRECT
bun run version:patch
# Or use release commands
bun run release:patch
```

## Troubleshooting

### Version Mismatch

```bash
# Check versions in ALL files
grep '"version"' package.json .claude-plugin/plugin.json marketplace.json

# Fix by running version bump
bun run version:patch
```

### Marketplace Shows Old Version

```bash
# Check if root marketplace.json is updated
grep '"version"' marketplace.json

# Re-sync
bun run sync-testmarketplace
```

### Plugin Update Fails (for users)

```bash
claude /plugins uninstall projmnt4claude
claude /plugins install projmnt4claude
```

## Quick Reference

```
┌─────────────────────────────────────────────────────┐
│           BUILD & RELEASE CHEATSHEET               │
├─────────────────────────────────────────────────────┤
│ bun run build           # Build only               │
│ bun run version:patch   # Bump patch version       │
│ bun run release:patch   # Bump + Build + Sync      │
│ git add . && git commit # Commit release           │
│ git push                # ⚠️ 用户手动执行            │
├─────────────────────────────────────────────────────┤
│ ⚠️ 重要规则:                                        │
│   - NEVER manually edit version numbers!           │
│   - NEVER modify git remote URL!                   │
│   - NEVER auto-push! (用户手动推送)                 │
│                                                     │
│ Version files (4):                                  │
│   - package.json                                    │
│   - .claude-plugin/plugin.json                      │
│   - .claude-plugin/marketplace.json                 │
│   - marketplace.json (root) ← Claude Code reads this│
└─────────────────────────────────────────────────────┘
```
