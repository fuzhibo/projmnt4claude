/**
 * 登录按钮组件类型定义
 * 修复移动端宽度超出容器的问题
 */

/**
 * 登录按钮属性接口
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
 * 登录按钮状态接口
 */
export interface LoginButtonState {
  /** 加载状态 */
  isLoading: boolean;
  /** 按下状态 */
  isPressed: boolean;
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
 * 默认按钮配置
 */
export const defaultLoginButtonConfig = {
  type: 'submit' as const,
  disabled: false,
  size: ButtonSize.MEDIUM,
  variant: ButtonVariant.PRIMARY
};

/**
 * 样式选项接口
 */
export interface StyleOptions {
  /** 是否禁用 */
  disabled?: boolean;
}

/**
 * 响应式样式集合
 */
export interface ResponsiveStyles {
  /** 移动端样式 (< 768px) */
  mobile: Record<string, string | number>;
  /** 平板样式 (768px - 1024px) */
  tablet: Record<string, string | number>;
  /** 桌面端样式 (> 1024px) */
  desktop: Record<string, string | number>;
}

/**
 * 创建按钮选项接口
 */
export interface CreateButtonOptions {
  /** 是否禁用 */
  disabled?: boolean;
  /** 点击回调 */
  onClick?: () => void;
}

// 重新导出 .tsx 文件中的所有类型和函数
export {
  getLoginButtonStyles,
  getResponsiveStyles,
  createLoginButtonElement,
  getLoginButtonClassNames,
  generateLoginButtonCSS
} from './LoginButton';
