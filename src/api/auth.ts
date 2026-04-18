// API Authentication Module - Login interface with timeout handling

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

const DEFAULT_TIMEOUT = 10000; // 10 seconds default timeout

/**
 * Fetch request with timeout control
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
      throw new Error('Request timeout, please try again later');
    }
    throw error;
  }
}

/**
 * Login interface - with timeout handling
 * @param request Login request parameters
 * @param timeout Timeout in milliseconds, default 10 seconds
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
          message: 'Server response timeout, please try again later',
        };
      }

      if (response.status === 401) {
        return {
          success: false,
          message: 'Invalid username or password',
        };
      }

      return {
        success: false,
        message: `Login failed: HTTP ${response.status}`,
      };
    }

    const data = await response.json();

    console.log(`[Auth] Login successful, response time: ${responseTime}ms`);

    return {
      success: true,
      token: data.token,
      message: 'Login successful',
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    console.error(`[Auth] Login failed, elapsed time: ${responseTime}ms`, error);

    if (error instanceof Error && error.message.includes('timeout')) {
      return {
        success: false,
        message: 'Request timeout, please check your network connection and try again',
      };
    }

    return {
      success: false,
      message: 'Network error, please check your network connection',
    };
  }
}

/**
 * Create API client with timeout configuration
 */
export function createAuthClient(config: ApiConfig) {
  return {
    /**
     * Login method
     */
    login: (request: LoginRequest): Promise<LoginResponse> =>
      login(request, config.timeout),

    /**
     * Logout method
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
        console.error('[Auth] Logout failed', error);
      }
    },
  };
}

// Default export
export default {
  login,
  createAuthClient,
};
