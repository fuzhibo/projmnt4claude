/**
 * Login Button Component
 * Fixes mobile width overflow issue
 *
 * @example
 * ```tsx
 * import { LoginButton, getLoginButtonStyles } from './LoginButton';
 *
 * // Get button styles (includes mobile fix)
 * const styles = getLoginButtonStyles({ disabled: false });
 *
 * // Use in React
 * <button style={styles}>Login</button>
 * ```
 */

export interface LoginButtonProps {
  /** Click callback function */
  onClick?: () => void;
  /** Whether disabled */
  disabled?: boolean;
  /** Button content */
  children?: string;
  /** Button type */
  type?: 'button' | 'submit' | 'reset';
}

/**
 * Button size enum
 */
export enum ButtonSize {
  SMALL = 'small',
  MEDIUM = 'medium',
  LARGE = 'large'
}

/**
 * Button variant enum
 */
export enum ButtonVariant {
  PRIMARY = 'primary',
  SECONDARY = 'secondary',
  GHOST = 'ghost'
}

/**
 * Login button state interface
 */
export interface LoginButtonState {
  isLoading: boolean;
  isPressed: boolean;
}

/**
 * Default button configuration
 */
export const defaultLoginButtonConfig = {
  type: 'submit' as const,
  disabled: false,
  size: ButtonSize.MEDIUM,
  variant: ButtonVariant.PRIMARY
};

/**
 * Get CSS-in-JS style object for login button
 * Fixes mobile width overflow issue
 *
 * @param options - Style options
 * @returns CSS style object
 */
export function getLoginButtonStyles(options: { disabled?: boolean } = {}): Record<string, string | number> {
  const { disabled = false } = options;

  return {
    // Base styles
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: 600,
    color: '#ffffff',
    backgroundColor: disabled ? '#cccccc' : '#1890ff',
    border: 'none',
    borderRadius: '8px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background-color 0.2s ease',

    // Fix mobile width issue: use maxWidth and width control
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',

    // Prevent text overflow
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  };
}

/**
 * Get responsive styles for mobile
 * Adaptation for different screen sizes
 */
export function getResponsiveStyles(): Record<string, Record<string, string | number>> {
  return {
    // Mobile styles (< 768px)
    mobile: {
      width: '100%',
      maxWidth: '100%',
      padding: '12px 16px',
      fontSize: '16px' // Prevent iOS zoom
    },
    // Tablet styles (768px - 1024px)
    tablet: {
      width: '100%',
      maxWidth: '400px',
      padding: '12px 24px'
    },
    // Desktop styles (> 1024px)
    desktop: {
      width: 'auto',
      minWidth: '200px',
      maxWidth: '100%',
      padding: '12px 32px'
    }
  };
}

/**
 * Create login button HTML element
 * For non-React environments
 */
export function createLoginButtonElement(
  text: string = 'Login',
  options: { disabled?: boolean; onClick?: () => void } = {}
): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = text;
  button.type = 'submit';

  // Apply styles
  const styles = getLoginButtonStyles(options);
  Object.assign(button.style, styles);

  if (options.disabled) {
    button.disabled = true;
  }

  if (options.onClick) {
    button.addEventListener('click', options.onClick);
  }

  return button;
}

/**
 * Get CSS class names (for traditional CSS approach)
 */
export function getLoginButtonClassNames(): string {
  return 'login-button login-button--responsive';
}

/**
 * Generate CSS string
 * Can be injected into <style> tag
 */
export function generateLoginButtonCSS(): string {
  return `
    .login-button {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px 24px;
      font-size: 16px;
      font-weight: 600;
      color: #ffffff;
      background-color: #1890ff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: background-color 0.2s ease;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .login-button:hover:not(:disabled) {
      background-color: #40a9ff;
    }

    .login-button:disabled {
      background-color: #cccccc;
      cursor: not-allowed;
    }

    /* Mobile responsive */
    @media (max-width: 767px) {
      .login-button {
        width: 100%;
        max-width: 100%;
        padding: 12px 16px;
      }
    }

    /* Tablet */
    @media (min-width: 768px) and (max-width: 1023px) {
      .login-button {
        width: 100%;
        max-width: 400px;
      }
    }

    /* Desktop */
    @media (min-width: 1024px) {
      .login-button {
        width: auto;
        min-width: 200px;
      }
    }
  `;
}

// Default export
export default {
  getLoginButtonStyles,
  getResponsiveStyles,
  createLoginButtonElement,
  getLoginButtonClassNames,
  generateLoginButtonCSS,
  defaultConfig: defaultLoginButtonConfig
};
