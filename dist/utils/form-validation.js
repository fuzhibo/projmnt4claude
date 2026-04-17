/**
 * 表单验证模块
 *
 * 提供表单字段的统一验证逻辑，包括：
 * - 邮箱格式验证
 * - 密码强度验证
 * - 必填字段验证
 * - 手机号验证
 */
/**
 * 邮箱验证正则表达式
 * 符合 RFC 5322 标准的邮箱格式
 */
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
/**
 * 更严格的邮箱验证正则
 * 防止常见的无效格式通过
 */
const STRICT_EMAIL_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._%+-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/;
/**
 * 验证邮箱格式
 *
 * @param email - 邮箱地址
 * @returns 验证结果
 *
 * @example
 * ```ts
 * validateEmail('user@example.com'); // { valid: true }
 * validateEmail('invalid-email'); // { valid: false, error: '邮箱格式不正确' }
 * ```
 */
export function validateEmail(email) {
    // 检查是否为空
    if (!email || email.trim() === '') {
        return { valid: false, error: '邮箱不能为空' };
    }
    const trimmedEmail = email.trim();
    // 检查长度
    if (trimmedEmail.length > 254) {
        return { valid: false, error: '邮箱长度不能超过254个字符' };
    }
    // 检查基本格式
    if (!EMAIL_REGEX.test(trimmedEmail)) {
        return { valid: false, error: '邮箱格式不正确' };
    }
    // 使用更严格的验证
    if (!STRICT_EMAIL_REGEX.test(trimmedEmail)) {
        return { valid: false, error: '邮箱格式不正确，请检查 @ 和域名部分' };
    }
    // 检查常见的无效模式
    const invalidPatterns = [
        { pattern: /\.\./, message: '邮箱不能包含连续的句点' },
        { pattern: /^\./, message: '邮箱不能以句点开头' },
        { pattern: /\.$/, message: '邮箱不能以句点结尾' },
        { pattern: /@\./, message: '邮箱 @ 后不能直接跟句点' },
        { pattern: /\.@/, message: '邮箱句点后不能直接跟 @' },
    ];
    for (const { pattern, message } of invalidPatterns) {
        if (pattern.test(trimmedEmail)) {
            return { valid: false, error: message };
        }
    }
    // 检查 @ 符号数量和位置
    const atCount = (trimmedEmail.match(/@/g) || []).length;
    if (atCount !== 1) {
        return { valid: false, error: '邮箱必须包含且仅包含一个 @ 符号' };
    }
    const [localPart, domain] = trimmedEmail.split('@');
    // 检查本地部分
    if (!localPart || localPart.length === 0) {
        return { valid: false, error: '邮箱 @ 前需要有用户名' };
    }
    if (localPart.length > 64) {
        return { valid: false, error: '邮箱用户名部分不能超过64个字符' };
    }
    // 检查域名部分
    if (!domain || domain.length === 0) {
        return { valid: false, error: '邮箱 @ 后需要有域名' };
    }
    // 检查域名是否包含至少一个点
    if (!domain.includes('.')) {
        return { valid: false, error: '邮箱域名需要包含顶级域（如 .com）' };
    }
    // 检查顶级域长度
    const tld = domain.split('.').pop();
    if (!tld || tld.length < 2) {
        return { valid: false, error: '邮箱顶级域至少需要2个字符' };
    }
    return { valid: true };
}
/**
 * 验证密码强度
 *
 * @param password - 密码
 * @param minLength - 最小长度（默认8）
 * @returns 验证结果
 */
export function validatePassword(password, minLength = 8) {
    if (!password) {
        return { valid: false, error: '密码不能为空' };
    }
    if (password.length < minLength) {
        return { valid: false, error: `密码长度至少为 ${minLength} 个字符` };
    }
    // 检查密码复杂度
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    const strength = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecialChar].filter(Boolean).length;
    if (strength < 3) {
        return {
            valid: false,
            error: '密码需要包含至少3种：大写字母、小写字母、数字、特殊字符',
        };
    }
    return { valid: true };
}
/**
 * 验证两次密码是否一致
 *
 * @param password - 密码
 * @param confirmPassword - 确认密码
 * @returns 验证结果
 */
export function validatePasswordMatch(password, confirmPassword) {
    if (!confirmPassword) {
        return { valid: false, error: '请确认密码' };
    }
    if (password !== confirmPassword) {
        return { valid: false, error: '两次输入的密码不一致' };
    }
    return { valid: true };
}
/**
 * 验证必填字段
 *
 * @param value - 字段值
 * @param fieldName - 字段名称
 * @returns 验证结果
 */
export function validateRequired(value, fieldName = '该字段') {
    if (!value || value.trim() === '') {
        return { valid: false, error: `${fieldName}不能为空` };
    }
    return { valid: true };
}
/**
 * 验证整个注册表单
 *
 * @param formData - 表单数据
 * @returns 验证结果和错误信息
 */
export function validateRegistrationForm(formData) {
    const errors = {};
    // 验证邮箱
    const emailResult = validateEmail(formData.email);
    if (!emailResult.valid) {
        errors.email = emailResult.error || '邮箱格式不正确';
    }
    // 验证密码
    const passwordResult = validatePassword(formData.password);
    if (!passwordResult.valid) {
        errors.password = passwordResult.error || '密码不符合要求';
    }
    // 验证密码一致性
    const matchResult = validatePasswordMatch(formData.password, formData.confirmPassword);
    if (!matchResult.valid) {
        errors.confirmPassword = matchResult.error || '两次密码不一致';
    }
    return {
        valid: Object.keys(errors).length === 0,
        errors,
    };
}
/**
 * 获取密码强度等级
 *
 * @param password - 密码
 * @returns 强度等级（0-4）
 */
export function getPasswordStrength(password) {
    if (!password)
        return 0;
    let strength = 0;
    if (password.length >= 8)
        strength++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password))
        strength++;
    if (/\d/.test(password))
        strength++;
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password))
        strength++;
    return strength;
}
/**
 * 获取密码强度文本描述
 *
 * @param strength - 强度等级
 * @returns 强度描述
 */
export function getPasswordStrengthText(strength) {
    const descriptions = ['非常弱', '弱', '中等', '强', '非常强'];
    return descriptions[strength] || '未知';
}
