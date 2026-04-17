/**
 * 表单验证模块测试
 *
 * 测试邮箱验证、密码验证等核心功能
 */
import { validateEmail, validatePassword, validatePasswordMatch, validateRequired, validateRegistrationForm, getPasswordStrength, getPasswordStrengthText, } from '../form-validation';
describe('邮箱验证 (validateEmail)', () => {
    // 有效的邮箱格式
    describe('有效邮箱格式', () => {
        const validEmails = [
            'user@example.com',
            'test.email@domain.com',
            'user123@test.org',
            'user_name@example.co.uk',
            'user-name@domain.io',
            'user+tag@example.com',
            'a@b.co',
            'firstname.lastname@company.com',
            'user@subdomain.domain.com',
            '123@456.com',
            'user@domain.museum',
            'user@domain.info',
        ];
        test.each(validEmails)('应该接受有效邮箱: %s', (email) => {
            const result = validateEmail(email);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });
    });
    // 无效的邮箱格式 - 常见错误
    describe('无效邮箱格式 - 常见错误', () => {
        const invalidEmails = [
            { email: '', expectedError: '邮箱不能为空' },
            { email: '   ', expectedError: '邮箱不能为空' },
            { email: 'invalid-email', expectedError: '邮箱格式不正确' },
            { email: 'user@', expectedError: '邮箱格式不正确' },
            { email: '@example.com', expectedError: '邮箱格式不正确' },
            { email: 'user@@example.com', expectedError: '邮箱格式不正确' },
            { email: 'user@example', expectedError: '邮箱格式不正确，请检查 @ 和域名部分' },
            { email: 'user@.com', expectedError: '邮箱格式不正确' },
            { email: 'user@domain..com', expectedError: '邮箱格式不正确' },
            { email: '.user@example.com', expectedError: '邮箱格式不正确，请检查 @ 和域名部分' },
            { email: 'user.@example.com', expectedError: '邮箱句点后不能直接跟 @' },
            { email: 'user@.example.com', expectedError: '邮箱格式不正确' },
            { email: 'user..name@example.com', expectedError: '邮箱不能包含连续的句点' },
            { email: 'user name@example.com', expectedError: '邮箱格式不正确' },
            { email: 'user@exam ple.com', expectedError: '邮箱格式不正确' },
        ];
        test.each(invalidEmails)('应该拒绝无效邮箱 "$email"', ({ email, expectedError }) => {
            const result = validateEmail(email);
            expect(result.valid).toBe(false);
            expect(result.error).toBe(expectedError);
        });
    });
    // 边缘情况
    describe('边缘情况', () => {
        test('应该处理超长的本地部分', () => {
            const longLocalPart = 'a'.repeat(65);
            const result = validateEmail(`${longLocalPart}@example.com`);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('邮箱用户名部分不能超过64个字符');
        });
        test('应该处理超长的邮箱地址', () => {
            const longEmail = 'a'.repeat(250) + '@example.com';
            const result = validateEmail(longEmail);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('邮箱长度不能超过254个字符');
        });
        test('应该处理极短的顶级域', () => {
            const result = validateEmail('user@domain.c');
            expect(result.valid).toBe(false);
            expect(result.error).toBe('邮箱格式不正确，请检查 @ 和域名部分');
        });
    });
    // 格式清理
    describe('格式清理', () => {
        test('应该去除前后空格', () => {
            const result = validateEmail('  user@example.com  ');
            expect(result.valid).toBe(true);
        });
    });
});
describe('密码验证 (validatePassword)', () => {
    describe('有效密码', () => {
        const validPasswords = [
            'Password123!',
            'MyP@ssw0rd',
            'Complex#123',
            'Test$5678',
            'A1b2C3d4!',
        ];
        test.each(validPasswords)('应该接受有效密码', (password) => {
            const result = validatePassword(password);
            expect(result.valid).toBe(true);
        });
    });
    describe('无效密码', () => {
        test('应该拒绝空密码', () => {
            const result = validatePassword('');
            expect(result.valid).toBe(false);
            expect(result.error).toBe('密码不能为空');
        });
        test('应该拒绝过短的密码', () => {
            const result = validatePassword('Pass1!');
            expect(result.valid).toBe(false);
            expect(result.error).toBe('密码长度至少为 8 个字符');
        });
        test('应该拒绝过于简单的密码', () => {
            const result = validatePassword('password123');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('密码需要包含至少3种');
        });
        test('应该允许自定义最小长度', () => {
            const result = validatePassword('Pass1!', 6);
            expect(result.valid).toBe(true);
        });
    });
});
describe('密码匹配验证 (validatePasswordMatch)', () => {
    test('应该接受匹配的密码', () => {
        const result = validatePasswordMatch('Password123!', 'Password123!');
        expect(result.valid).toBe(true);
    });
    test('应该拒绝不匹配的密码', () => {
        const result = validatePasswordMatch('Password123!', 'Password123@');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('两次输入的密码不一致');
    });
    test('应该拒绝空的确认密码', () => {
        const result = validatePasswordMatch('Password123!', '');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('请确认密码');
    });
});
describe('必填字段验证 (validateRequired)', () => {
    test('应该接受非空值', () => {
        const result = validateRequired('some value');
        expect(result.valid).toBe(true);
    });
    test('应该拒绝空值', () => {
        const result = validateRequired('');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('该字段不能为空');
    });
    test('应该拒绝空白字符', () => {
        const result = validateRequired('   ');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('该字段不能为空');
    });
    test('应该使用自定义字段名', () => {
        const result = validateRequired('', '用户名');
        expect(result.error).toBe('用户名不能为空');
    });
});
describe('注册表单验证 (validateRegistrationForm)', () => {
    test('应该验证完整的有效表单', () => {
        const formData = {
            email: 'user@example.com',
            password: 'Password123!',
            confirmPassword: 'Password123!',
        };
        const result = validateRegistrationForm(formData);
        expect(result.valid).toBe(true);
        expect(Object.keys(result.errors)).toHaveLength(0);
    });
    test('应该返回所有字段的错误', () => {
        const formData = {
            email: 'invalid-email',
            password: '123',
            confirmPassword: '456',
        };
        const result = validateRegistrationForm(formData);
        expect(result.valid).toBe(false);
        expect(result.errors.email).toBeDefined();
        expect(result.errors.password).toBeDefined();
        expect(result.errors.confirmPassword).toBeDefined();
    });
    test('应该只返回错误字段', () => {
        const formData = {
            email: 'user@example.com',
            password: 'Password123!',
            confirmPassword: 'Different123!',
        };
        const result = validateRegistrationForm(formData);
        expect(result.valid).toBe(false);
        expect(result.errors.email).toBeUndefined();
        expect(result.errors.password).toBeUndefined();
        expect(result.errors.confirmPassword).toBeDefined();
    });
});
describe('密码强度计算 (getPasswordStrength)', () => {
    test('应该返回0（空密码）', () => {
        expect(getPasswordStrength('')).toBe(0);
    });
    test('应该返回1（只有长度）', () => {
        expect(getPasswordStrength('password')).toBe(1);
    });
    test('应该返回2（长度+大小写）', () => {
        expect(getPasswordStrength('Password')).toBe(2);
    });
    test('应该返回3（长度+大小写+数字）', () => {
        expect(getPasswordStrength('Password1')).toBe(3);
    });
    test('应该返回4（全部条件）', () => {
        expect(getPasswordStrength('Password1!')).toBe(4);
    });
});
describe('密码强度文本 (getPasswordStrengthText)', () => {
    test.each([
        [0, '非常弱'],
        [1, '弱'],
        [2, '中等'],
        [3, '强'],
        [4, '非常强'],
    ])('强度等级 %i 应该返回 "%s"', (strength, expected) => {
        expect(getPasswordStrengthText(strength)).toBe(expected);
    });
    test('应该处理无效值', () => {
        expect(getPasswordStrengthText(5)).toBe('未知');
        expect(getPasswordStrengthText(-1)).toBe('未知');
    });
});
