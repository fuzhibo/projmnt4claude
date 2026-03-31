/**
 * 统一输出格式常量
 * 所有命令文件应使用此处的常量，确保输出风格一致
 */

/** 统一分隔线宽度 */
export const SEPARATOR_WIDTH = 60;

/** 生成分隔线 */
export function separator(char = '━', width = SEPARATOR_WIDTH): string {
  return char.repeat(width);
}
