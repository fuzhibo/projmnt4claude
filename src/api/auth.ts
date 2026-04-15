// API 认证模块 - 带超时处理的登录接口

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  message?: string;
}

export interface ApiConfig {
  baseUrl: string;
  timeout: number;
}

const DEFAULT_TIMEOUT = 10000; // 10秒默认超时

/**
 * 带超时控制的 fetch 请求
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试');
    }
    throw error;
  }
}

/**
 * 登录接口 - 带超时处理
 * @param request 登录请求参数
 * @param timeout 超时时间（毫秒），默认10秒
 */
export async function login(
  request: LoginRequest,
  timeout: number = DEFAULT_TIMEOUT
): Promise<LoginResponse> {
  const startTime = Date.now();

  try {
    const response = await fetchWithTimeout(
      '/api/auth/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      },
      timeout
    );

    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      if (response.status === 408 || response.status === 504) {
        return {
          success: false,
          message: '服务器响应超时，请稍后重试',
        };
      }

      if (response.status === 401) {
        return {
          success: false,
          message: '用户名或密码错误',
        };
      }

      return {
        success: false,
        message: `登录失败: HTTP ${response.status}`,
      };
    }

    const data = await response.json();

    console.log(`[Auth] 登录成功，响应时间: ${responseTime}ms`);

    return {
      success: true,
      token: data.token,
      message: '登录成功',
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    console.error(`[Auth] 登录失败，耗时: ${responseTime}ms`, error);

    if (error instanceof Error && error.message.includes('超时')) {
      return {
        success: false,
        message: '请求超时，请检查网络连接后重试',
      };
    }

    return {
      success: false,
      message: '网络错误，请检查网络连接',
    };
  }
}

/**
 * 创建带超时配置的 API 客户端
 */
export function createAuthClient(config: ApiConfig) {
  return {
    /**
     * 登录方法
     */
    login: (request: LoginRequest): Promise<LoginResponse> =>
      login(request, config.timeout),

    /**
     * 登出方法
     */
    logout: async (): Promise<void> => {
      try {
        await fetchWithTimeout(
          `${config.baseUrl}/api/auth/logout`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          },
          config.timeout
        );
      } catch (error) {
        console.error('[Auth] 登出失败', error);
      }
    },
  };
}

// 默认导出
export default {
  login,
  createAuthClient,
};
