/**
 * 登录按钮组件
 * 修复移动端宽度超出容器的问题
 *
 * @example
 * ```tsx
 * import { LoginButton, getLoginButtonStyles } from './LoginButton';
 *
 * // 获取按钮样式（包含移动端修复）
 * const styles = getLoginButtonStyles({ disabled: false });
 *
 * // React 中使用
 * <button style={styles}>登录</button>
 * ```
 */

export interface LoginButtonProps {
  /** 点击回调函数 */
  onClick?: () => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 按钮内容 */
  children?: string;
  /** 按钮类型 */
  type?: 'button' | 'submit' | 'reset';
}

/**
 * 按钮尺寸枚举
 */
export enum ButtonSize {
  SMALL = 'small',
  MEDIUM = 'medium',
  LARGE = 'large'
}

/**
 * 按钮变体枚举
 */
export enum ButtonVariant {
  PRIMARY = 'primary',
  SECONDARY = 'secondary',
  GHOST = 'ghost'
}

/**
 * 登录按钮状态接口
 */
export interface LoginButtonState {
  isLoading: boolean;
  isPressed: boolean;
}

/**
 * 默认按钮配置
 */
export const defaultLoginButtonConfig = {
  type: 'submit' as const,
  disabled: false,
  size: ButtonSize.MEDIUM,
  variant: ButtonVariant.PRIMARY
};

/**
 * 获取登录按钮的 CSS-in-JS 样式对象
 * 修复移动端宽度超出容器的问题
 *
 * @param options - 样式选项
 * @returns CSS 样式对象
 */
export function getLoginButtonStyles(options: { disabled?: boolean } = {}): Record<string, string | number> {
  const { disabled = false } = options;

  return {
    // 基础样式
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

    // 修复移动端宽度问题：使用 maxWidth 和 width 控制
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',

    // 防止文本溢出
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  };
}

/**
 * 获取移动端响应式样式
 * 针对不同屏幕尺寸的适配
 */
export function getResponsiveStyles(): Record<string, Record<string, string | number>> {
  return {
    // 移动端样式 (< 768px)
    mobile: {
      width: '100%',
      maxWidth: '100%',
      padding: '12px 16px',
      fontSize: '16px' // 防止 iOS 缩放
    },
    // 平板样式 (768px - 1024px)
    tablet: {
      width: '100%',
      maxWidth: '400px',
      padding: '12px 24px'
    },
    // 桌面端样式 (> 1024px)
    desktop: {
      width: 'auto',
      minWidth: '200px',
      maxWidth: '100%',
      padding: '12px 32px'
    }
  };
}

/**
 * 创建登录按钮 HTML 元素
 * 用于非 React 环境
 */
export function createLoginButtonElement(
  text: string = '登录',
  options: { disabled?: boolean; onClick?: () => void } = {}
): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = text;
  button.type = 'submit';

  // 应用样式
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
 * 获取 CSS 类名样式（用于传统 CSS 方案）
 */
export function getLoginButtonClassNames(): string {
  return 'login-button login-button--responsive';
}

/**
 * 生成 CSS 字符串
 * 可用于注入到 <style> 标签
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

    /* 移动端响应式 */
    @media (max-width: 767px) {
      .login-button {
        width: 100%;
        max-width: 100%;
        padding: 12px 16px;
      }
    }

    /* 平板端 */
    @media (min-width: 768px) and (max-width: 1023px) {
      .login-button {
        width: 100%;
        max-width: 400px;
      }
    }

    /* 桌面端 */
    @media (min-width: 1024px) {
      .login-button {
        width: auto;
        min-width: 200px;
      }
    }
  `;
}

// 默认导出
export default {
  getLoginButtonStyles,
  getResponsiveStyles,
  createLoginButtonElement,
  getLoginButtonClassNames,
  generateLoginButtonCSS,
  defaultConfig: defaultLoginButtonConfig
};
