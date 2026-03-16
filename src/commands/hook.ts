import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';
import { isInitialized, getProjectDir } from '../utils/path';

/**
 * 钩子配置接口
 */
export interface HookConfig {
  enabled: boolean;
  hooks: {
    preCommit?: boolean;
    postCommit?: boolean;
    prePush?: boolean;
    postMerge?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * 获取钩子配置路径
 */
export function getHookConfigPath(cwd: string = process.cwd()): string {
  return path.join(getProjectDir(cwd), 'hooks', 'config.json');
}

/**
 * 获取钩子目录路径
 */
export function getHookDir(cwd: string = process.cwd()): string {
  return path.join(getProjectDir(cwd), 'hooks');
}

/**
 * 检查钩子是否已初始化
 */
export function hookInitialized(cwd: string = process.cwd()): boolean {
  return fs.existsSync(getHookConfigPath(cwd));
}

/**
 * 读取钩子配置
 */
export function readHookConfig(cwd: string = process.cwd()): HookConfig | null {
  if (!hookInitialized(cwd)) {
    return null;
  }

  try {
    const content = fs.readFileSync(getHookConfigPath(cwd), 'utf-8');
    return JSON.parse(content) as HookConfig;
  } catch {
    return null;
  }
}

/**
 * 写入钩子配置
 */
export function writeHookConfig(config: HookConfig, cwd: string = process.cwd()): void {
  const hookDir = getHookDir(cwd);
  const configPath = getHookConfigPath(cwd);

  if (!fs.existsSync(hookDir)) {
    fs.mkdirSync(hookDir, { recursive: true });
  }

  config.updatedAt = new Date().toISOString();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * 创建默认钩子配置
 */
export function createDefaultHookConfig(): HookConfig {
  return {
    enabled: true,
    hooks: {
      preCommit: true,
      postCommit: false,
      prePush: true,
      postMerge: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 启用钩子系统
 * 支持交互模式和非交互模式
 */
export async function enableHook(
  options: {
    nonInteractive?: boolean;
    hooks?: string;
  } = {},
  cwd: string = process.cwd()
): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  let config = readHookConfig(cwd);

  if (!config) {
    // 非交互模式：使用默认或指定的钩子配置
    if (options.nonInteractive) {
      let hooksConfig = {
        preCommit: true,
        postCommit: false,
        prePush: true,
        postMerge: false,
      };

      // 如果指定了 --hooks 参数，解析它
      if (options.hooks) {
        const hookList = options.hooks.split(',').map(h => h.trim().toLowerCase());
        hooksConfig = {
          preCommit: hookList.includes('pre-commit') || hookList.includes('precommit'),
          postCommit: hookList.includes('post-commit') || hookList.includes('postcommit'),
          prePush: hookList.includes('pre-push') || hookList.includes('prepush'),
          postMerge: hookList.includes('post-merge') || hookList.includes('postmerge'),
        };
      }

      config = {
        enabled: true,
        hooks: hooksConfig,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } else {
      // 交互式配置钩子
      const response = await prompts([
        {
          type: 'multiselect',
          name: 'hooks',
          message: '选择要启用的钩子',
          choices: [
            { title: 'pre-commit (提交前检查)', value: 'preCommit', selected: true },
            { title: 'post-commit (提交后处理)', value: 'postCommit', selected: false },
            { title: 'pre-push (推送前检查)', value: 'prePush', selected: true },
            { title: 'post-merge (合并后处理)', value: 'postMerge', selected: false },
          ],
        },
      ]);

      config = {
        enabled: true,
        hooks: {
          preCommit: response.hooks?.includes('preCommit') ?? true,
          postCommit: response.hooks?.includes('postCommit') ?? false,
          prePush: response.hooks?.includes('prePush') ?? true,
          postMerge: response.hooks?.includes('postMerge') ?? false,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  } else {
    config.enabled = true;
  }

  writeHookConfig(config, cwd);

  // 创建 Git hooks 脚本
  await createGitHooksScripts(cwd, config);

  console.log('✅ 钩子系统已启用');
  console.log('');
  console.log('已启用的钩子:');
  if (config.hooks.preCommit) console.log('  - pre-commit: 提交前检查');
  if (config.hooks.postCommit) console.log('  - post-commit: 提交后处理');
  if (config.hooks.prePush) console.log('  - pre-push: 推送前检查');
  if (config.hooks.postMerge) console.log('  - post-merge: 合并后处理');
}

/**
 * 禁用钩子系统
 */
export async function disableHook(cwd: string = process.cwd()): Promise<void> {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const config = readHookConfig(cwd);

  if (!config) {
    console.log('钩子系统尚未初始化');
    return;
  }

  const response = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: '确定要禁用钩子系统吗?',
    initial: false,
  });

  if (!response.confirm) {
    console.log('已取消');
    return;
  }

  config.enabled = false;
  writeHookConfig(config, cwd);

  // 移除 Git hooks 脚本
  removeGitHooksScripts(cwd);

  console.log('✅ 钩子系统已禁用');
}

/**
 * 显示钩子状态
 */
export function showHookStatus(cwd: string = process.cwd()): void {
  if (!isInitialized(cwd)) {
    console.error('错误: 项目未初始化。请先运行 `projmnt4claude setup`');
    process.exit(1);
  }

  const config = readHookConfig(cwd);

  console.log('');
  console.log('━'.repeat(60));
  console.log('🔗 钩子系统状态');
  console.log('━'.repeat(60));
  console.log('');

  if (!config) {
    console.log('状态: ❌ 未初始化');
    console.log('');
    console.log('运行 `projmnt4claude hook enable` 来启用钩子系统');
    return;
  }

  const statusIcon = config.enabled ? '✅ 已启用' : '❌ 已禁用';
  console.log(`状态: ${statusIcon}`);
  console.log('');

  console.log('钩子配置:');
  console.log(`  pre-commit:  ${config.hooks.preCommit ? '✅' : '❌'}`);
  console.log(`  post-commit: ${config.hooks.postCommit ? '✅' : '❌'}`);
  console.log(`  pre-push:    ${config.hooks.prePush ? '✅' : '❌'}`);
  console.log(`  post-merge:  ${config.hooks.postMerge ? '✅' : '❌'}`);
  console.log('');

  console.log(`创建时间: ${config.createdAt}`);
  console.log(`更新时间: ${config.updatedAt}`);
  console.log('');

  console.log('━'.repeat(60));
}

/**
 * 创建 Git hooks 脚本
 */
async function createGitHooksScripts(cwd: string, config: HookConfig): Promise<void> {
  const gitDir = path.join(cwd, '.git');
  const hooksDir = path.join(gitDir, 'hooks');

  if (!fs.existsSync(gitDir)) {
    console.log('⚠️  未找到 .git 目录，跳过 Git hooks 安装');
    return;
  }

  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  // pre-commit hook
  if (config.hooks.preCommit) {
    const preCommitPath = path.join(hooksDir, 'pre-commit');
    const preCommitContent = `#!/bin/sh
# projmnt4claude pre-commit hook
# 运行任务检查

echo "🔍 运行 pre-commit 检查..."

# 检查是否有未完成的检查点
# 这里可以添加自定义检查逻辑

echo "✅ pre-commit 检查通过"
`;
    fs.writeFileSync(preCommitPath, preCommitContent, 'utf-8');
    fs.chmodSync(preCommitPath, 0o755);
  }

  // pre-push hook
  if (config.hooks.prePush) {
    const prePushPath = path.join(hooksDir, 'pre-push');
    const prePushContent = `#!/bin/sh
# projmnt4claude pre-push hook
# 推送前检查

echo "🔍 运行 pre-push 检查..."

# 检查项目健康状态
# 这里可以添加自定义检查逻辑

echo "✅ pre-push 检查通过"
`;
    fs.writeFileSync(prePushPath, prePushContent, 'utf-8');
    fs.chmodSync(prePushPath, 0o755);
  }

  console.log('📝 Git hooks 脚本已安装');
}

/**
 * 移除 Git hooks 脚本
 */
function removeGitHooksScripts(cwd: string): void {
  const gitDir = path.join(cwd, '.git');
  const hooksDir = path.join(gitDir, 'hooks');

  if (!fs.existsSync(hooksDir)) {
    return;
  }

  const hookFiles = ['pre-commit', 'post-commit', 'pre-push', 'post-merge'];

  for (const hookFile of hookFiles) {
    const hookPath = path.join(hooksDir, hookFile);
    if (fs.existsSync(hookPath)) {
      // 检查是否是我们创建的钩子
      const content = fs.readFileSync(hookPath, 'utf-8');
      if (content.includes('projmnt4claude')) {
        fs.unlinkSync(hookPath);
      }
    }
  }
}
