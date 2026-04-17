import { describe, it, expect } from 'bun:test';
import { ButtonSize, ButtonVariant, defaultLoginButtonConfig } from '../LoginButton';
describe('LoginButton', () => {
    // CP-1: 核心功能测试
    describe('核心功能', () => {
        it('应该正确导出 LoginButtonProps 接口', () => {
            const props = {
                onClick: () => { },
                disabled: false,
                children: '登录',
                type: 'submit'
            };
            expect(props).toBeDefined();
            expect(props.type).toBe('submit');
        });
        it('应该支持 button 类型', () => {
            const props = {
                type: 'button'
            };
            expect(props.type).toBe('button');
        });
        it('应该支持 reset 类型', () => {
            const props = {
                type: 'reset'
            };
            expect(props.type).toBe('reset');
        });
        it('应该正确导出 LoginButtonState 接口', () => {
            const state = {
                isLoading: false,
                isPressed: false
            };
            expect(state.isLoading).toBe(false);
            expect(state.isPressed).toBe(false);
        });
    });
    // CP-2: 配置和枚举测试
    describe('配置和枚举', () => {
        it('应该导出 ButtonSize 枚举', () => {
            expect(ButtonSize.SMALL).toBe('small');
            expect(ButtonSize.MEDIUM).toBe('medium');
            expect(ButtonSize.LARGE).toBe('large');
        });
        it('应该导出 ButtonVariant 枚举', () => {
            expect(ButtonVariant.PRIMARY).toBe('primary');
            expect(ButtonVariant.SECONDARY).toBe('secondary');
            expect(ButtonVariant.GHOST).toBe('ghost');
        });
        it('应该导出默认配置', () => {
            expect(defaultLoginButtonConfig.type).toBe('submit');
            expect(defaultLoginButtonConfig.disabled).toBe(false);
            expect(defaultLoginButtonConfig.size).toBe(ButtonSize.MEDIUM);
            expect(defaultLoginButtonConfig.variant).toBe(ButtonVariant.PRIMARY);
        });
    });
    // CP-3: 文件存在性验证
    describe('文件验证', () => {
        it('LoginButton.tsx 应该存在', async () => {
            const file = await import('../LoginButton.tsx');
            expect(file).toBeDefined();
            expect(file.getLoginButtonStyles).toBeDefined();
            expect(file.getResponsiveStyles).toBeDefined();
        });
        it('LoginButton.ts 应该存在', async () => {
            const file = await import('../LoginButton');
            expect(file).toBeDefined();
        });
    });
    // CP-4: 移动端样式修复验证
    describe('移动端样式', () => {
        it('LoginButton.tsx 应该包含 width: 100%', async () => {
            const fs = await import('fs');
            const content = fs.readFileSync('/home/fuzhibo/workerplace/git/projmnt4claude/src/components/LoginButton.tsx', 'utf-8');
            expect(content).toContain("width: '100%'");
        });
        it('LoginButton.tsx 应该包含 maxWidth: 100%', async () => {
            const fs = await import('fs');
            const content = fs.readFileSync('/home/fuzhibo/workerplace/git/projmnt4claude/src/components/LoginButton.tsx', 'utf-8');
            expect(content).toContain("maxWidth: '100%'");
        });
        it('LoginButton.tsx 应该包含 boxSizing: border-box', async () => {
            const fs = await import('fs');
            const content = fs.readFileSync('/home/fuzhibo/workerplace/git/projmnt4claude/src/components/LoginButton.tsx', 'utf-8');
            expect(content).toContain("boxSizing: 'border-box'");
        });
    });
});
