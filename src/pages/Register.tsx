/**
 * User Registration Page Component
 *
 * Features:
 * - Email registration
 * - Password setup
 * - Form validation
 * - Error messages
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  validateEmail,
  validatePassword,
  validatePasswordMatch,
  validateRegistrationForm,
  getPasswordStrength,
  getPasswordStrengthText,
  type ValidationResult,
} from '../utils/form-validation';

export interface RegisterFormData {
  email: string;
  password: string;
  confirmPassword: string;
}

export interface RegisterFormErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export interface RegisterProps {
  onSubmit?: (data: RegisterFormData) => Promise<void>;
  onSuccess?: () => void;
  loading?: boolean;
}

/**
 * Registration page component
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
export const Register: React.FC<RegisterProps> = ({
  onSubmit,
  onSuccess,
  loading: externalLoading = false,
}) => {
  // Form state
  const [formData, setFormData] = useState<RegisterFormData>({
    email: '',
    password: '',
    confirmPassword: '',
  });

  // Error state
  const [errors, setErrors] = useState<RegisterFormErrors>({});

  // Touched state (for delayed error display)
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Submit state
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loading = externalLoading || isSubmitting;

  /**
   * Update form field
   */
  const updateField = useCallback((field: keyof RegisterFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Real-time validation for current field
    let validationResult: ValidationResult;

    switch (field) {
      case 'email':
        validationResult = validateEmail(value);
        break;
      case 'password':
        validationResult = validatePassword(value);
        // If confirm password is filled, re-validate password match
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
   * Mark field as touched
   */
  const markTouched = useCallback((field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
  }, []);

  /**
   * Get whether field should show error
   */
  const shouldShowError = useCallback((field: string): boolean => {
    return touched[field] && !!errors[field as keyof RegisterFormErrors];
  }, [touched, errors]);

  /**
   * Validate entire form
   */
  const validateForm = useCallback((): boolean => {
    const result = validateRegistrationForm(formData);
    setErrors(result.errors);
    // Mark all fields as touched
    setTouched({
      email: true,
      password: true,
      confirmPassword: true,
    });
    return result.valid;
  }, [formData]);

  /**
   * Handle form submission
   */
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
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
    } catch (error) {
      // Handle submission error
      const errorMessage = error instanceof Error ? error.message : 'Registration failed, please try again later';
      setErrors(prev => ({ ...prev, submit: errorMessage }));
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, onSubmit, onSuccess, validateForm]);

  /**
   * Password strength
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

  return (
    <div className="register-container">
      <div className="register-card">
        <h1 className="register-title">User Registration</h1>
        <p className="register-subtitle">Create your new account</p>

        <form onSubmit={handleSubmit} className="register-form" noValidate>
          {/* Email field */}
          <div className="form-field">
            <label htmlFor="email" className="form-label">
              Email Address <span className="required">*</span>
            </label>
            <input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => updateField('email', e.target.value)}
              onBlur={() => markTouched('email')}
              className={`form-input ${shouldShowError('email') ? 'error' : ''}`}
              placeholder="Please enter your email"
              disabled={loading}
              autoComplete="email"
            />
            {shouldShowError('email') && (
              <span className="error-message">{errors.email}</span>
            )}
            <span className="field-hint">We will send a verification email to this address</span>
          </div>

          {/* Password field */}
          <div className="form-field">
            <label htmlFor="password" className="form-label">
              Password <span className="required">*</span>
            </label>
            <input
              id="password"
              type="password"
              value={formData.password}
              onChange={(e) => updateField('password', e.target.value)}
              onBlur={() => markTouched('password')}
              className={`form-input ${shouldShowError('password') ? 'error' : ''}`}
              placeholder="Please set a password"
              disabled={loading}
              autoComplete="new-password"
            />
            {shouldShowError('password') && (
              <span className="error-message">{errors.password}</span>
            )}
            {formData.password && (
              <div className="password-strength">
                <span className="strength-label">Password Strength:</span>
                <div className="strength-bar">
                  {[0, 1, 2, 3].map((level) => (
                    <div
                      key={level}
                      className={`strength-segment ${level < passwordStrength ? 'active' : ''}`}
                      style={{
                        backgroundColor: level < passwordStrength ? passwordStrengthColor : '#d9d9d9',
                      }}
                    />
                  ))}
                </div>
                <span
                  className="strength-text"
                  style={{ color: passwordStrengthColor }}
                >
                  {passwordStrengthText}
                </span>
              </div>
            )}
            <span className="field-hint">
              Password must be at least 8 characters, containing at least 3 of: uppercase, lowercase, numbers, and special characters
            </span>
          </div>

          {/* Confirm password field */}
          <div className="form-field">
            <label htmlFor="confirmPassword" className="form-label">
              Confirm Password <span className="required">*</span>
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={formData.confirmPassword}
              onChange={(e) => updateField('confirmPassword', e.target.value)}
              onBlur={() => markTouched('confirmPassword')}
              className={`form-input ${shouldShowError('confirmPassword') ? 'error' : ''}`}
              placeholder="Please enter the password again"
              disabled={loading}
              autoComplete="new-password"
            />
            {shouldShowError('confirmPassword') && (
              <span className="error-message">{errors.confirmPassword}</span>
            )}
          </div>

          {/* Submit error */}
          {errors.submit && (
            <div className="submit-error">
              {errors.submit}
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            className="submit-button"
            disabled={loading}
          >
            {loading ? 'Registering...' : 'Register'}
          </button>

          {/* Login link */}
          <div className="login-link">
            Already have an account? <a href="/login">Login now</a>
          </div>
        </form>
      </div>

      <style>{`
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
      `}</style>
    </div>
  );
};

export default Register;
