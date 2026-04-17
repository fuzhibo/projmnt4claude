import * as fs from 'fs';
import * as path from 'path';
import { getConfigPath } from '../utils/path';
// 导入语言包
import { zhTexts } from './zh';
import { enTexts } from './en';
const languagePacks = {
    zh: zhTexts,
    en: enTexts,
};
/**
 * 获取用户项目配置的语言
 */
export function getLanguage(cwd = process.cwd()) {
    const configPath = getConfigPath(cwd);
    try {
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            return config.language || 'zh';
        }
    }
    catch (error) {
        // 忽略错误，使用默认语言
    }
    return 'zh';
}
/**
 * 获取国际化文本
 */
export function getI18n(language, cwd) {
    const lang = language || getLanguage(cwd);
    return languagePacks[lang] || languagePacks.zh;
}
/**
 * 快捷函数：获取当前语言的文本
 */
export function t(cwd) {
    return getI18n(undefined, cwd);
}
