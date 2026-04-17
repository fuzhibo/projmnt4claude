/**
 * ai-metadata.ts 非AI部分单元测试
 * 测试 classifyFileToLayer, groupFilesByLayer, sortFilesByLayer 函数
 */
import { describe, test, expect } from 'bun:test';
import { classifyFileToLayer, groupFilesByLayer, sortFilesByLayer, LAYER_DEFINITIONS, } from '../utils/ai-metadata';
describe('classifyFileToLayer 文件分类', () => {
    describe('正常输入处理', () => {
        test('应将类型定义文件分类为 Layer0', () => {
            expect(classifyFileToLayer('src/types/task.ts')).toBe('Layer0');
            expect(classifyFileToLayer('src/interfaces/user.ts')).toBe('Layer0');
            expect(classifyFileToLayer('src/schemas/config.json')).toBe('Layer0');
        });
        test('应将工具函数文件分类为 Layer1', () => {
            expect(classifyFileToLayer('src/utils/ai-metadata.ts')).toBe('Layer1');
            expect(classifyFileToLayer('src/helpers/file.ts')).toBe('Layer1');
            expect(classifyFileToLayer('src/lib/parser.js')).toBe('Layer1');
        });
        test('应将核心业务逻辑文件分类为 Layer2', () => {
            expect(classifyFileToLayer('src/core/processor.ts')).toBe('Layer2');
            expect(classifyFileToLayer('src/services/user-service.ts')).toBe('Layer2');
            expect(classifyFileToLayer('src/processors/data.ts')).toBe('Layer2');
        });
        test('应将命令/入口文件分类为 Layer3', () => {
            expect(classifyFileToLayer('src/commands/init.ts')).toBe('Layer3');
            expect(classifyFileToLayer('src/cli/main.ts')).toBe('Layer3');
            expect(classifyFileToLayer('src/index.ts')).toBe('Layer3');
        });
    });
    describe('边界条件处理', () => {
        test('应处理 Windows 路径分隔符', () => {
            expect(classifyFileToLayer('src\\utils\\file.ts')).toBe('Layer1');
            expect(classifyFileToLayer('src\\commands\\init.ts')).toBe('Layer3');
            expect(classifyFileToLayer('src\\types\\task.ts')).toBe('Layer0');
        });
        test('应处理深层嵌套路径', () => {
            expect(classifyFileToLayer('src/utils/deep/nested/file.ts')).toBe('Layer1');
            expect(classifyFileToLayer('src/commands/sub/cmd/action.ts')).toBe('Layer3');
        });
        test('应处理带点的文件名', () => {
            expect(classifyFileToLayer('src/utils/file.name.ts')).toBe('Layer1');
            expect(classifyFileToLayer('src/types/task.meta.ts')).toBe('Layer0');
        });
        test('应正确匹配 index.ts 结尾路径', () => {
            expect(classifyFileToLayer('src/index.ts')).toBe('Layer3');
            expect(classifyFileToLayer('src/utils/index.ts')).toBe('Layer1');
        });
    });
    describe('异常输入处理', () => {
        test('空字符串应返回默认 Layer1', () => {
            expect(classifyFileToLayer('')).toBe('Layer1');
        });
        test('不匹配任何模式的路径应返回默认 Layer1', () => {
            expect(classifyFileToLayer('random/path/file.ts')).toBe('Layer1');
            expect(classifyFileToLayer('test/file.js')).toBe('Layer1');
            expect(classifyFileToLayer('foo/bar/baz.ts')).toBe('Layer1');
        });
        test('应处理仅包含文件名的路径', () => {
            expect(classifyFileToLayer('file.ts')).toBe('Layer1');
            expect(classifyFileToLayer('index.ts')).toBe('Layer1');
        });
        test('应处理特殊字符路径', () => {
            expect(classifyFileToLayer('src/utils/file-name_test.ts')).toBe('Layer1');
            expect(classifyFileToLayer('src/utils/[id].ts')).toBe('Layer1');
        });
    });
});
describe('groupFilesByLayer 按层分组', () => {
    describe('正常输入处理', () => {
        test('应将文件正确分组到对应层级', () => {
            const files = [
                'src/types/task.ts',
                'src/utils/file.ts',
                'src/core/processor.ts',
                'src/commands/init.ts',
            ];
            const groups = groupFilesByLayer(files);
            expect(groups.get('Layer0')).toContain('src/types/task.ts');
            expect(groups.get('Layer1')).toContain('src/utils/file.ts');
            expect(groups.get('Layer2')).toContain('src/core/processor.ts');
            expect(groups.get('Layer3')).toContain('src/commands/init.ts');
        });
        test('应将同层级文件归为一组', () => {
            const files = [
                'src/types/task.ts',
                'src/types/user.ts',
                'src/types/config.ts',
            ];
            const groups = groupFilesByLayer(files);
            expect(groups.get('Layer0')).toHaveLength(3);
            expect(groups.get('Layer0')).toContain('src/types/task.ts');
            expect(groups.get('Layer0')).toContain('src/types/user.ts');
            expect(groups.get('Layer0')).toContain('src/types/config.ts');
        });
        test('应按 Layer0-3 顺序返回分组', () => {
            const files = [
                'src/commands/init.ts',
                'src/utils/file.ts',
                'src/types/task.ts',
                'src/core/processor.ts',
            ];
            const groups = groupFilesByLayer(files);
            const keys = Array.from(groups.keys());
            expect(keys).toEqual(['Layer0', 'Layer1', 'Layer2', 'Layer3']);
        });
    });
    describe('边界条件处理', () => {
        test('应处理空数组', () => {
            const groups = groupFilesByLayer([]);
            expect(groups.size).toBe(0);
        });
        test('应处理单文件数组', () => {
            const groups = groupFilesByLayer(['src/types/task.ts']);
            expect(groups.size).toBe(1);
            expect(groups.get('Layer0')).toHaveLength(1);
        });
        test('应处理大量文件', () => {
            const files = [];
            for (let i = 0; i < 100; i++) {
                files.push(`src/utils/file${i}.ts`);
            }
            const groups = groupFilesByLayer(files);
            expect(groups.get('Layer1')).toHaveLength(100);
        });
        test('应处理只包含默认层级的文件', () => {
            const files = ['test/file1.ts', 'test/file2.ts'];
            const groups = groupFilesByLayer(files);
            expect(groups.size).toBe(1);
            expect(groups.get('Layer1')).toHaveLength(2);
        });
    });
    describe('异常输入处理', () => {
        test('应处理包含重复文件的数组', () => {
            const files = ['src/utils/file.ts', 'src/utils/file.ts'];
            const groups = groupFilesByLayer(files);
            expect(groups.get('Layer1')).toHaveLength(2);
        });
        test('应处理包含空字符串的数组', () => {
            const files = ['src/types/task.ts', '', 'src/utils/file.ts'];
            const groups = groupFilesByLayer(files);
            expect(groups.get('Layer0')).toHaveLength(1);
            expect(groups.get('Layer1')).toHaveLength(2);
        });
        test('应处理混合有效和无效路径', () => {
            const files = [
                'src/types/task.ts',
                'invalid/path',
                'src/commands/init.ts',
                '',
            ];
            const groups = groupFilesByLayer(files);
            expect(groups.get('Layer0')).toHaveLength(1);
            expect(groups.get('Layer1')).toHaveLength(2);
            expect(groups.get('Layer3')).toHaveLength(1);
        });
    });
});
describe('sortFilesByLayer 按层排序', () => {
    describe('正常输入处理', () => {
        test('应按 Layer0 → Layer3 顺序排序', () => {
            const files = [
                'src/commands/init.ts',
                'src/utils/file.ts',
                'src/types/task.ts',
                'src/core/processor.ts',
            ];
            const sorted = sortFilesByLayer(files);
            expect(sorted[0]).toBe('src/types/task.ts');
            expect(sorted[1]).toBe('src/utils/file.ts');
            expect(sorted[2]).toBe('src/core/processor.ts');
            expect(sorted[3]).toBe('src/commands/init.ts');
        });
        test('应保持同层级文件的相对顺序', () => {
            const files = [
                'src/utils/file3.ts',
                'src/utils/file1.ts',
                'src/utils/file2.ts',
            ];
            const sorted = sortFilesByLayer(files);
            expect(sorted).toEqual([
                'src/utils/file3.ts',
                'src/utils/file1.ts',
                'src/utils/file2.ts',
            ]);
        });
        test('应处理跨层级混合文件', () => {
            const files = [
                'src/commands/cmd1.ts',
                'src/types/type1.ts',
                'src/core/core1.ts',
                'src/types/type2.ts',
                'src/utils/util1.ts',
            ];
            const sorted = sortFilesByLayer(files);
            expect(sorted[0]).toContain('types');
            expect(sorted[1]).toContain('types');
            expect(sorted[2]).toContain('utils');
            expect(sorted[3]).toContain('core');
            expect(sorted[4]).toContain('commands');
        });
    });
    describe('边界条件处理', () => {
        test('应处理空数组', () => {
            const sorted = sortFilesByLayer([]);
            expect(sorted).toEqual([]);
        });
        test('应处理单文件数组', () => {
            const files = ['src/types/task.ts'];
            const sorted = sortFilesByLayer(files);
            expect(sorted).toEqual(['src/types/task.ts']);
        });
        test('应处理所有文件同层级的情况', () => {
            const files = [
                'src/utils/file1.ts',
                'src/utils/file2.ts',
                'src/utils/file3.ts',
            ];
            const sorted = sortFilesByLayer(files);
            expect(sorted).toHaveLength(3);
        });
        test('应处理反向顺序输入', () => {
            const files = [
                'src/commands/init.ts',
                'src/core/processor.ts',
                'src/utils/file.ts',
                'src/types/task.ts',
            ];
            const sorted = sortFilesByLayer(files);
            expect(sorted[0]).toBe('src/types/task.ts');
            expect(sorted[3]).toBe('src/commands/init.ts');
        });
    });
    describe('异常输入处理', () => {
        test('不应修改原数组', () => {
            const files = ['src/types/task.ts', 'src/utils/file.ts'];
            const filesCopy = [...files];
            sortFilesByLayer(files);
            expect(files).toEqual(filesCopy);
        });
        test('应处理包含空字符串的数组', () => {
            const files = ['src/types/task.ts', '', 'src/utils/file.ts'];
            const sorted = sortFilesByLayer(files);
            expect(sorted).toHaveLength(3);
            // 空字符串应被归为 Layer1（默认层）
            expect(sorted[0]).toBe('src/types/task.ts');
        });
        test('应处理包含重复文件的数组', () => {
            const files = ['src/utils/file.ts', 'src/utils/file.ts'];
            const sorted = sortFilesByLayer(files);
            expect(sorted).toHaveLength(2);
        });
        test('应返回新数组而非修改原数组', () => {
            const files = ['src/types/task.ts'];
            const sorted = sortFilesByLayer(files);
            expect(sorted).not.toBe(files);
            expect(sorted).toEqual(files);
        });
    });
});
describe('LAYER_DEFINITIONS 常量', () => {
    test('应包含所有四个层级的定义', () => {
        expect(LAYER_DEFINITIONS.Layer0).toBeDefined();
        expect(LAYER_DEFINITIONS.Layer1).toBeDefined();
        expect(LAYER_DEFINITIONS.Layer2).toBeDefined();
        expect(LAYER_DEFINITIONS.Layer3).toBeDefined();
    });
    test('每个层级应包含 label 和 description', () => {
        for (const layer of ['Layer0', 'Layer1', 'Layer2', 'Layer3']) {
            expect(LAYER_DEFINITIONS[layer].label).toBeDefined();
            expect(LAYER_DEFINITIONS[layer].description).toBeDefined();
            expect(LAYER_DEFINITIONS[layer].pathPatterns).toBeInstanceOf(Array);
        }
    });
});
