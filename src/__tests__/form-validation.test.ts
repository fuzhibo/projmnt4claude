/**
 * form-validation 模块单元测试
 *
 * 测试表单验证工具函数
 */

import { describe, it, expect } from 'bun:test';
import {
  validateEmail,
  validatePassword,
  validatePasswordMatch,
  validateRequired,
  validateRegistrationForm,
  getPasswordStrength,
  getPasswordStrengthText,
} from '../utils/form-validation.js';

// ============================================================
// validateEmail
// ============================================================

describe('validateEmail', () => {
  // --- Normal cases ---

  it('should return valid for correct email', () => {
    const result = validateEmail('user@example.com');
    expect(result.valid).toBe(true);
  });

  it('should return valid for email with subdomain', () => {
    const result = validateEmail('user@mail.example.com');
    expect(result.valid).toBe(true);
  });

  it('should return valid for email with numbers', () => {
    const result = validateEmail('user123@example123.com');
    expect(result.valid).toBe(true);
  });

  it('should return valid for email with plus sign', () => {
    const result = validateEmail('user+tag@example.com');
    expect(result.valid).toBe(true);
  });

  // --- Edge cases ---

  it('should return invalid for empty string', () => {
    const result = validateEmail('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should return invalid for whitespace only', () => {
    const result = validateEmail('   ');
    expect(result.valid).toBe(false);
  });

  it('should return invalid for email without @', () => {
    const result = validateEmail('userexample.com');
    expect(result.valid).toBe(false);
  });

  it('should return invalid for email with multiple @', () => {
    const result = validateEmail('user@@example.com');
    expect(result.valid).toBe(false);
  });

  it('should return invalid for email without domain', () => {
    const result = validateEmail('user@');
    expect(result.valid).toBe(false);
  });

  it('should return invalid for email without local part', () => {
    const result = validateEmail('@example.com');
    expect(result.valid).toBe(false);
  });

  it('should return invalid for email without TLD', () => {
    const result = validateEmail('user@example');
    expect(result.valid).toBe(false);
  });

  it('should return invalid for email starting with dot', () => {
    const result = validateEmail('.user@example.com');
    expect(result.valid).toBe(false);
  });

  it('should return invalid for email ending with dot', () => {
    const result = validateEmail('user.@example.com');
    expect(result.valid).toBe(false);
  });

  it('should return invalid for email with consecutive dots', () => {
    const result = validateEmail('user..name@example.com');
    expect(result.valid).toBe(false);
  });

  it('should return invalid for email longer than 254 chars', () => {
    const longEmail = 'a'.repeat(250) + '@x.com';
    const result = validateEmail(longEmail);
    expect(result.valid).toBe(false);
  });
});

// ============================================================
// validatePassword
// ============================================================

describe('validatePassword', () => {
  // --- Normal cases ---

  it('should return valid for strong password', () => {
    const result = validatePassword('Password123!');
    expect(result.valid).toBe(true);
  });

  it('should return valid for password with 3 character types', () => {
    const result = validatePassword('Password123');
    expect(result.valid).toBe(true);
  });

  it('should return valid for password with custom min length', () => {
    const result = validatePassword('Pass1!', 6);
    expect(result.valid).toBe(true);
  });

  // --- Edge cases ---

  it('should return invalid for empty password', () => {
    const result = validatePassword('');
    expect(result.valid).toBe(false);
  });

  it('should return invalid for password shorter than min length', () => {
    const result = validatePassword('Pass1!', 10);
    expect(result.valid).toBe(false);
  });

  it('should return invalid for password with only 2 character types', () => {
    const result = validatePassword('password123'); // lowercase + numbers only
    expect(result.valid).toBe(false);
  });

  it('should return invalid for password with only lowercase', () => {
    const result = validatePassword('password');
    expect(result.valid).toBe(false);
  });

  it('should return invalid for password with only numbers', () => {
    const result = validatePassword('12345678');
    expect(result.valid).toBe(false);
  });
});

// ============================================================
// validatePasswordMatch
// ============================================================

describe('validatePasswordMatch', () => {
  // --- Normal cases ---

  it('should return valid when passwords match', () => {
    const result = validatePasswordMatch('password123', 'password123');
    expect(result.valid).toBe(true);
  });

  // --- Edge cases ---

  it('should return invalid when passwords do not match', () => {
    const result = validatePasswordMatch('password123', 'password456');
    expect(result.valid).toBe(false);
  });

  it('should return invalid when confirm password is empty', () => {
    const result = validatePasswordMatch('password123', '');
    expect(result.valid).toBe(false);
  });

  it('should return invalid when confirm password is undefined', () => {
    const result = validatePasswordMatch('password123', undefined as unknown as string);
    expect(result.valid).toBe(false);
  });
});

// ============================================================
// validateRequired
// ============================================================

describe('validateRequired', () => {
  // --- Normal cases ---

  it('should return valid for non-empty string', () => {
    const result = validateRequired('value');
    expect(result.valid).toBe(true);
  });

  it('should return valid with custom field name', () => {
    const result = validateRequired('value', '用户名');
    expect(result.valid).toBe(true);
  });

  // --- Edge cases ---

  it('should return invalid for empty string', () => {
    const result = validateRequired('');
    expect(result.valid).toBe(false);
  });

  it('should return invalid for whitespace only', () => {
    const result = validateRequired('   ');
    expect(result.valid).toBe(false);
  });

  it('should return invalid with custom field name in error', () => {
    const result = validateRequired('', '用户名');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('用户名');
  });
});

// ============================================================
// validateRegistrationForm
// ============================================================

describe('validateRegistrationForm', () => {
  // --- Normal cases ---

  it('should return valid for correct form data', () => {
    const result = validateRegistrationForm({
      email: 'user@example.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
    });
    expect(result.valid).toBe(true);
    expect(Object.keys(result.errors).length).toBe(0);
  });

  // --- Edge cases ---

  it('should return invalid for invalid email', () => {
    const result = validateRegistrationForm({
      email: 'invalid',
      password: 'Password123!',
      confirmPassword: 'Password123!',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.email).toBeDefined();
  });

  it('should return invalid for weak password', () => {
    const result = validateRegistrationForm({
      email: 'user@example.com',
      password: 'weak',
      confirmPassword: 'weak',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.password).toBeDefined();
  });

  it('should return invalid for mismatched passwords', () => {
    const result = validateRegistrationForm({
      email: 'user@example.com',
      password: 'Password123!',
      confirmPassword: 'Different123!',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.confirmPassword).toBeDefined();
  });

  it('should return multiple errors for multiple invalid fields', () => {
    const result = validateRegistrationForm({
      email: '',
      password: '',
      confirmPassword: '',
    });
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).length).toBeGreaterThan(1);
  });
});

// ============================================================
// getPasswordStrength
// ============================================================

describe('getPasswordStrength', () => {
  // --- Normal cases ---

  it('should return 4 for very strong password', () => {
    const strength = getPasswordStrength('Password123!');
    expect(strength).toBe(4);
  });

  it('should return 3 for strong password', () => {
    const strength = getPasswordStrength('Password123');
    expect(strength).toBe(3);
  });

  it('should return 2 for medium password', () => {
    const strength = getPasswordStrength('password123');
    expect(strength).toBe(2);
  });

  it('should return 1 for weak password', () => {
    const strength = getPasswordStrength('password');
    expect(strength).toBe(1);
  });

  // --- Edge cases ---

  it('should return 0 for empty password', () => {
    const strength = getPasswordStrength('');
    expect(strength).toBe(0);
  });

  it('should return 0 for short password', () => {
    const strength = getPasswordStrength('pass');
    expect(strength).toBe(0);
  });
});

// ============================================================
// getPasswordStrengthText
// ============================================================

describe('getPasswordStrengthText', () => {
  // --- Normal cases ---

  it('should return correct text for each strength level', () => {
    expect(getPasswordStrengthText(0)).toBe('非常弱');
    expect(getPasswordStrengthText(1)).toBe('弱');
    expect(getPasswordStrengthText(2)).toBe('中等');
    expect(getPasswordStrengthText(3)).toBe('强');
    expect(getPasswordStrengthText(4)).toBe('非常强');
  });

  // --- Edge cases ---

  it('should return unknown for invalid strength', () => {
    expect(getPasswordStrengthText(5)).toBe('未知');
    expect(getPasswordStrengthText(-1)).toBe('未知');
  });
});
