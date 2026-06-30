---
description: "运行环境诊断，检查并修复设置问题"
argument-hint: "[--fix] [--bug-report]"
---

# doctor - 环境诊断

运行环境诊断，检查 projmnt4claude 设置问题并可选修复。

## 执行方式

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/projmnt4claude.js doctor [options]
```

## 选项速查

| 选项 | 说明 |
|------|------|
| `--fix` | 自动修复检测到的问题，修复后自动重新检查 |
| `--bug-report` | 生成 Bug 报告（含日志压缩附件、AI 成本汇总、使用分析） |

## 检测项目

- 项目初始化（config.json 存在性）
- 插件安装作用域与缓存完整性
- 命令文档安装状态
- 任务命名格式与类型一致性
- 目录结构完整性
- Hooks 配置完整性
- 任务规范对齐
- 日志模块就绪性

## 详细文档

完整使用说明请参考: `skills/projmnt4claude/commands/doctor.md`
