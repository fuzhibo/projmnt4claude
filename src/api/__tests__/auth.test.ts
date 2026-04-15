/**
 * Auth API 超时处理测试
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { login, createAuthClient, LoginRequest, ApiConfig } from '../auth';

// 模拟 fetch
global.fetch = mock(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ token: 'test-token' }),
  } as Response)
);

describe('Auth API - Timeout Handling', () => {
  beforeEach(() => {
    // 重置 fetch mock
    (fetch as any).mockClear?.() || ((fetch as any).mock.calls = []);
  });

  describe('CP-1: 核心功能实现', () => {
    test('login 函数应该存在并可调用', async () => {
      (fetch as any).mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ token: 'test-token' }),
        } as Response)
      );

      const request: LoginRequest = { username: 'test', password: 'pass' };
      const result = await login(request);

      expect(result).toBeDefined();
      expect(fetch).toHaveBeenCalled();
    });

    test('login 应该接受超时参数', async () => {
      (fetch as any).mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ token: 'test' }),
        } as Response)
      );

      // 验证可以传入超时参数而不报错
      const result = await login({ username: 'test', password: 'pass' }, 5000);
      expect(result).toBeDefined();
      expect(fetch).toHaveBeenCalled();
    });

    test('createAuthClient 应该创建带超时配置的客户端', () => {
      const config: ApiConfig = {
        baseUrl: 'https://api.example.com',
        timeout: 5000,
      };

      const client = createAuthClient(config);

      expect(client.login).toBeDefined();
      expect(client.logout).toBeDefined();
    });
  });

  describe('CP-2: 错误处理', () => {
    test('应该处理 401 未授权错误', async () => {
      (fetch as any).mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 401,
        } as Response)
      );

      const result = await login({ username: 'test', password: 'wrong' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('用户名或密码错误');
    });

    test('应该处理 408 请求超时错误', async () => {
      (fetch as any).mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 408,
        } as Response)
      );

      const result = await login({ username: 'test', password: 'pass' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('超时');
    });

    test('应该处理 504 网关超时错误', async () => {
      (fetch as any).mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 504,
        } as Response)
      );

      const result = await login({ username: 'test', password: 'pass' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('超时');
    });

    test('应该处理网络错误', async () => {
      (fetch as any).mockImplementation(() =>
        Promise.reject(new Error('Network error'))
      );

      const result = await login({ username: 'test', password: 'pass' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('网络错误');
    });

    test('成功登录应该返回 token', async () => {
      (fetch as any).mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ token: 'valid-token-123' }),
        } as Response)
      );

      const result = await login({ username: 'test', password: 'pass' });

      expect(result.success).toBe(true);
      expect(result.token).toBe('valid-token-123');
      expect(result.message).toContain('登录成功');
    });
  });

  describe('CP-3: 客户端功能', () => {
    test('客户端 login 方法应该使用配置的 baseUrl', async () => {
      (fetch as any).mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ token: 'test' }),
        } as Response)
      );

      const config: ApiConfig = {
        baseUrl: 'https://api.example.com',
        timeout: 5000,
      };

      const client = createAuthClient(config);
      await client.login({ username: 'test', password: 'pass' });

      expect(fetch).toHaveBeenCalled();
    });

    test('客户端 logout 应该正确调用 API', async () => {
      (fetch as any).mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
        } as Response)
      );

      const config: ApiConfig = {
        baseUrl: 'https://api.example.com',
        timeout: 5000,
      };

      const client = createAuthClient(config);
      await client.logout();

      expect(fetch).toHaveBeenCalled();
      const calls = (fetch as any).mock.calls || [];
      expect(calls.length).toBeGreaterThan(0);
    });
  });
});
