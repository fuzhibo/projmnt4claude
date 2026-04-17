import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 用户注册页面组件
 *
 * 功能：
 * - 邮箱注册
 * - 密码设置
 * - 表单验证
 * - 错误提示
 */
import React, { useState, useCallback, useMemo } from 'react';
import { validateEmail, validatePassword, validatePasswordMatch, validateRegistrationForm, getPasswordStrength, getPasswordStrengthText, } from '../utils/form-validation';
/**
 * 注册页面组件
 *
 * @example
 * ```tsx
 * <Register
 *   onSubmit={async (data) => {
 *     await api.register(data);
 *   }}
 *   onSuccess={() => navigate('/login')}
 * />
 * ```
 */
export const Register = ({ onSubmit, onSuccess, loading: externalLoading = false, }) => {
    // 表单状态
    const [formData, setFormData] = useState({
        email: '',
        password: '',
        confirmPassword: '',
    });
    // 错误状态
    const [errors, setErrors] = useState({});
    // 触摸状态（用于延迟显示错误）
    const [touched, setTouched] = useState({});
    // 提交状态
    const [isSubmitting, setIsSubmitting] = useState(false);
    const loading = externalLoading || isSubmitting;
    /**
     * 更新表单字段
     */
    const updateField = useCallback((field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        // 实时验证当前字段
        let validationResult;
        switch (field) {
            case 'email':
                validationResult = validateEmail(value);
                break;
            case 'password':
                validationResult = validatePassword(value);
                // 如果确认密码已填写，重新验证密码匹配
                if (formData.confirmPassword) {
                    const matchResult = validatePasswordMatch(value, formData.confirmPassword);
                    setErrors(prev => ({
                        ...prev,
                        password: validationResult.valid ? undefined : validationResult.error,
                        confirmPassword: matchResult.valid ? undefined : matchResult.error,
                    }));
                    return;
                }
                break;
            case 'confirmPassword':
                validationResult = validatePasswordMatch(formData.password, value);
                break;
            default:
                validationResult = { valid: true };
        }
        setErrors(prev => ({
            ...prev,
            [field]: validationResult.valid ? undefined : validationResult.error,
        }));
    }, [formData.password, formData.confirmPassword]);
    /**
     * 标记字段为已触摸
     */
    const markTouched = useCallback((field) => {
        setTouched(prev => ({ ...prev, [field]: true }));
    }, []);
    /**
     * 获取字段是否应显示错误
     */
    const shouldShowError = useCallback((field) => {
        return touched[field] && !!errors[field];
    }, [touched, errors]);
    /**
     * 验证整个表单
     */
    const validateForm = useCallback(() => {
        const result = validateRegistrationForm(formData);
        setErrors(result.errors);
        // 标记所有字段为已触摸
        setTouched({
            email: true,
            password: true,
            confirmPassword: true,
        });
        return result.valid;
    }, [formData]);
    /**
     * 处理表单提交
     */
    const handleSubmit = useCallback(async (e) => {
        e.preventDefault();
        if (!validateForm()) {
            return;
        }
        if (!onSubmit) {
            return;
        }
        setIsSubmitting(true);
        try {
            await onSubmit(formData);
            onSuccess?.();
        }
        catch (error) {
            // 处理提交错误
            const errorMessage = error instanceof Error ? error.message : '注册失败，请稍后重试';
            setErrors(prev => ({ ...prev, submit: errorMessage }));
        }
        finally {
            setIsSubmitting(false);
        }
    }, [formData, onSubmit, onSuccess, validateForm]);
    /**
     * 密码强度
     */
    const passwordStrength = useMemo(() => {
        return getPasswordStrength(formData.password);
    }, [formData.password]);
    const passwordStrengthText = useMemo(() => {
        return getPasswordStrengthText(passwordStrength);
    }, [passwordStrength]);
    const passwordStrengthColor = useMemo(() => {
        const colors = ['#ff4d4f', '#ff7a45', '#ffa940', '#73d13d', '#52c41a'];
        return colors[passwordStrength];
    }, [passwordStrength]);
    return (_jsxs("div", { className: "register-container", children: [_jsxs("div", { className: "register-card", children: [_jsx("h1", { className: "register-title", children: "\u7528\u6237\u6CE8\u518C" }), _jsx("p", { className: "register-subtitle", children: "\u521B\u5EFA\u60A8\u7684\u65B0\u8D26\u6237" }), _jsxs("form", { onSubmit: handleSubmit, className: "register-form", noValidate: true, children: [_jsxs("div", { className: "form-field", children: [_jsxs("label", { htmlFor: "email", className: "form-label", children: ["\u90AE\u7BB1\u5730\u5740 ", _jsx("span", { className: "required", children: "*" })] }), _jsx("input", { id: "email", type: "email", value: formData.email, onChange: (e) => updateField('email', e.target.value), onBlur: () => markTouched('email'), className: `form-input ${shouldShowError('email') ? 'error' : ''}`, placeholder: "\u8BF7\u8F93\u5165\u60A8\u7684\u90AE\u7BB1", disabled: loading, autoComplete: "email" }), shouldShowError('email') && (_jsx("span", { className: "error-message", children: errors.email })), _jsx("span", { className: "field-hint", children: "\u6211\u4EEC\u5C06\u5411\u6B64\u90AE\u7BB1\u53D1\u9001\u9A8C\u8BC1\u90AE\u4EF6" })] }), _jsxs("div", { className: "form-field", children: [_jsxs("label", { htmlFor: "password", className: "form-label", children: ["\u5BC6\u7801 ", _jsx("span", { className: "required", children: "*" })] }), _jsx("input", { id: "password", type: "password", value: formData.password, onChange: (e) => updateField('password', e.target.value), onBlur: () => markTouched('password'), className: `form-input ${shouldShowError('password') ? 'error' : ''}`, placeholder: "\u8BF7\u8BBE\u7F6E\u5BC6\u7801", disabled: loading, autoComplete: "new-password" }), shouldShowError('password') && (_jsx("span", { className: "error-message", children: errors.password })), formData.password && (_jsxs("div", { className: "password-strength", children: [_jsx("span", { className: "strength-label", children: "\u5BC6\u7801\u5F3A\u5EA6\uFF1A" }), _jsx("div", { className: "strength-bar", children: [0, 1, 2, 3].map((level) => (_jsx("div", { className: `strength-segment ${level < passwordStrength ? 'active' : ''}`, style: {
                                                        backgroundColor: level < passwordStrength ? passwordStrengthColor : '#d9d9d9',
                                                    } }, level))) }), _jsx("span", { className: "strength-text", style: { color: passwordStrengthColor }, children: passwordStrengthText })] })), _jsx("span", { className: "field-hint", children: "\u5BC6\u7801\u97008\u4F4D\u4EE5\u4E0A\uFF0C\u5305\u542B\u5927\u5C0F\u5199\u5B57\u6BCD\u3001\u6570\u5B57\u548C\u7279\u6B8A\u5B57\u7B26\u4E2D\u7684\u81F3\u5C113\u79CD" })] }), _jsxs("div", { className: "form-field", children: [_jsxs("label", { htmlFor: "confirmPassword", className: "form-label", children: ["\u786E\u8BA4\u5BC6\u7801 ", _jsx("span", { className: "required", children: "*" })] }), _jsx("input", { id: "confirmPassword", type: "password", value: formData.confirmPassword, onChange: (e) => updateField('confirmPassword', e.target.value), onBlur: () => markTouched('confirmPassword'), className: `form-input ${shouldShowError('confirmPassword') ? 'error' : ''}`, placeholder: "\u8BF7\u518D\u6B21\u8F93\u5165\u5BC6\u7801", disabled: loading, autoComplete: "new-password" }), shouldShowError('confirmPassword') && (_jsx("span", { className: "error-message", children: errors.confirmPassword }))] }), errors.submit && (_jsx("div", { className: "submit-error", children: errors.submit })), _jsx("button", { type: "submit", className: "submit-button", disabled: loading, children: loading ? '注册中...' : '注册' }), _jsxs("div", { className: "login-link", children: ["\u5DF2\u6709\u8D26\u6237\uFF1F", _jsx("a", { href: "/login", children: "\u7ACB\u5373\u767B\u5F55" })] })] })] }), _jsx("style", { children: `
        .register-container {
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          padding: 20px;
          background-color: #f5f5f5;
        }

        .register-card {
          width: 100%;
          max-width: 400px;
          padding: 32px;
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .register-title {
          margin: 0 0 8px;
          font-size: 24px;
          font-weight: 600;
          text-align: center;
          color: #262626;
        }

        .register-subtitle {
          margin: 0 0 24px;
          font-size: 14px;
          text-align: center;
          color: #8c8c8c;
        }

        .register-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .form-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-label {
          font-size: 14px;
          font-weight: 500;
          color: #262626;
        }

        .required {
          color: #ff4d4f;
        }

        .form-input {
          padding: 10px 12px;
          font-size: 14px;
          border: 1px solid #d9d9d9;
          border-radius: 4px;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .form-input:focus {
          outline: none;
          border-color: #1890ff;
          box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2);
        }

        .form-input.error {
          border-color: #ff4d4f;
        }

        .form-input.error:focus {
          box-shadow: 0 0 0 2px rgba(255, 77, 79, 0.2);
        }

        .form-input:disabled {
          background-color: #f5f5f5;
          cursor: not-allowed;
        }

        .error-message {
          font-size: 12px;
          color: #ff4d4f;
        }

        .field-hint {
          font-size: 12px;
          color: #8c8c8c;
        }

        .password-strength {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
        }

        .strength-label {
          color: #595959;
        }

        .strength-bar {
          display: flex;
          gap: 4px;
          flex: 1;
        }

        .strength-segment {
          flex: 1;
          height: 4px;
          border-radius: 2px;
          transition: background-color 0.2s;
        }

        .strength-text {
          min-width: 50px;
          text-align: right;
        }

        .submit-error {
          padding: 8px 12px;
          background-color: #fff2f0;
          border: 1px solid #ffccc7;
          border-radius: 4px;
          font-size: 14px;
          color: #ff4d4f;
        }

        .submit-button {
          padding: 12px 24px;
          font-size: 16px;
          font-weight: 500;
          color: white;
          background-color: #1890ff;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .submit-button:hover:not(:disabled) {
          background-color: #40a9ff;
        }

        .submit-button:disabled {
          background-color: #d9d9d9;
          cursor: not-allowed;
        }

        .login-link {
          text-align: center;
          font-size: 14px;
          color: #595959;
        }

        .login-link a {
          color: #1890ff;
          text-decoration: none;
        }

        .login-link a:hover {
          text-decoration: underline;
        }
      ` })] }));
};
export default Register;
