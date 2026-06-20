/**
 * Claude CLI 版本兼容检查（V2.1 §6.1.5）
 *
 * 2.1.123 收紧了 UUID 占用检查：裸复用相同 UUID（无 --resume 或 --fork-session）
 * 立即报错 "Session ID already in use"。本模块声明最低支持版本，并在启动时校验。
 */

/**
 * 最低支持的 Claude CLI 版本（含 §6.1.5 矩阵中 "完全支持" 的下界）
 */
export const MIN_SUPPORTED_CLI = '2.1.123';

/**
 * 已知存在 session bug 的版本（未来回填）
 */
export const KNOWN_BAD_CLI: string[] = [];

/**
 * Semver 风格版本号比较
 *
 * @returns 负数 (a<b) / 0 (a==b) / 正数 (a>b)
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) {
      return da - db;
    }
  }
  return 0;
}

/**
 * 版本兼容等级（对应 §6.1.5 矩阵）
 */
export type CliCompatLevel =
  | 'unsupported' // < 2.0.0
  | 'legacy' // 2.0.0 - 2.1.122
  | 'supported' // 2.1.123+
  | 'known-bad'; // 命中 KNOWN_BAD_CLI

/**
 * 推断给定 CLI 版本的兼容等级
 */
export function getCliCompatLevel(version: string): CliCompatLevel {
  if (KNOWN_BAD_CLI.includes(version)) {
    return 'known-bad';
  }
  if (compareVersions(version, '2.0.0') < 0) {
    return 'unsupported';
  }
  if (compareVersions(version, MIN_SUPPORTED_CLI) < 0) {
    return 'legacy';
  }
  return 'supported';
}

/**
 * 断言当前 Claude CLI 版本兼容
 *
 * @throws Error 当版本低于 MIN_SUPPORTED_CLI 或命中 KNOWN_BAD_CLI
 */
export function assertCliCompatible(actualVersion: string): void {
  const level = getCliCompatLevel(actualVersion);
  if (level === 'unsupported' || level === 'legacy') {
    throw new Error(
      `Claude CLI ${actualVersion} 低于最低支持版本 ${MIN_SUPPORTED_CLI}。` +
        `请运行 \`claude update\` 升级。`,
    );
  }
  if (level === 'known-bad') {
    throw new Error(
      `Claude CLI ${actualVersion} 已知存在 session bug，请跳过该版本。`,
    );
  }
}
