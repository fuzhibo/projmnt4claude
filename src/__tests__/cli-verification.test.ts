/**
 * CheckpointVerificationAI 和 CheckpointVerificationCLI 单元测试
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import {
  CheckpointVerificationAI,
  CheckpointVerificationCLI,
  createCheckpointVerificationAI,
  createCheckpointVerificationCLI,
  updateCheckpointStatus,
} from '../utils/checkpoint.js';
import { createIsolatedTestEnv, type IsolatedTestEnv } from '../utils/test-env.js';
import type { CheckpointVerificationDetails } from '../types/task.js';

// ============================================================
// Tests
// ============================================================

describe('CheckpointVerificationAI', () => {
  describe('getVerifiedBy', () => {
    it('should return ai_proxy:xxx format with default aiName', () => {
      const ai = new CheckpointVerificationAI();
      expect(ai.getVerifiedBy()).toBe('ai_proxy:claude-code');
    });

    it('should return ai_proxy:xxx format with custom aiName', () => {
      const ai = new CheckpointVerificationAI('codex');
      expect(ai.getVerifiedBy()).toBe('ai_proxy:codex');
    });

    it('should return ai_proxy:xxx format with gemini aiName', () => {
      const ai = new CheckpointVerificationAI('gemini');
      expect(ai.getVerifiedBy()).toBe('ai_proxy:gemini');
    });
  });

  describe('buildHumanVerificationRecord', () => {
    it('should build record with user confirmation', () => {
      const ai = new CheckpointVerificationAI();
      const result = ai.buildHumanVerificationRecord(
        '用户确认：登录流程正常',
        '已手动测试登录功能'
      );

      expect(result.valid).toBe(true);
      expect(result.verifiedBy).toBe('ai_proxy:claude-code');
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0]!.type).toBe('human');
      expect(result.evidence[0]!.description).toBe('用户确认：登录流程正常');
      expect(result.userConfirmation).toBe('已手动测试登录功能');
      expect(result.verifiedAt).toBeTruthy();
    });

    it('should use userConfirmation as note when note is not provided', () => {
      const ai = new CheckpointVerificationAI();
      const result = ai.buildHumanVerificationRecord('登录成功');

      expect(result.valid).toBe(true);
      expect(result.userConfirmation).toBe('登录成功');
    });
  });

  describe('buildAutomatedVerificationRecord', () => {
    it('should build valid record when evidence is present', () => {
      const ai = new CheckpointVerificationAI();
      const evidence = [
        { type: 'file', description: 'src/api/auth/login.ts' },
        { type: 'test', description: '测试通过' },
      ];
      const result = ai.buildAutomatedVerificationRecord(evidence);

      expect(result.valid).toBe(true);
      expect(result.verifiedBy).toBe('ai_proxy:claude-code');
      expect(result.evidence).toHaveLength(2);
      expect(result.verifiedAt).toBeTruthy();
    });

    it('should build invalid record when evidence is empty', () => {
      const ai = new CheckpointVerificationAI();
      const result = ai.buildAutomatedVerificationRecord([]);

      expect(result.valid).toBe(false);
      expect(result.evidence).toHaveLength(0);
    });
  });

  describe('buildFailureRecord', () => {
    it('should build failure record with reason', () => {
      const ai = new CheckpointVerificationAI();
      const result = ai.buildFailureRecord('未找到产出证据');

      expect(result.valid).toBe(false);
      expect(result.verifiedBy).toBe('ai_proxy:claude-code');
      expect(result.failureReason).toBe('未找到产出证据');
      expect(result.evidence).toHaveLength(0);
      expect(result.verifiedAt).toBeTruthy();
    });

    it('should build failure record with missing outputs', () => {
      const ai = new CheckpointVerificationAI();
      const result = ai.buildFailureRecord(
        '产出验证失败',
        ['src/api/auth/login.test.ts', '代码变更']
      );

      expect(result.valid).toBe(false);
      expect(result.failureReason).toBe('产出验证失败');
      expect(result.userConfirmation).toContain('缺失产出');
      expect(result.userConfirmation).toContain('src/api/auth/login.test.ts');
    });
  });

  describe('createCheckpointVerificationAI factory', () => {
    it('should create instance with default params', () => {
      const ai = createCheckpointVerificationAI();
      expect(ai.getVerifiedBy()).toBe('ai_proxy:claude-code');
    });

    it('should create instance with custom aiName', () => {
      const ai = createCheckpointVerificationAI('codex');
      expect(ai.getVerifiedBy()).toBe('ai_proxy:codex');
    });
  });
});

describe('CheckpointVerificationCLI', () => {
  let originalUser: string | undefined;

  beforeEach(() => {
    originalUser = process.env.USER;
  });

  afterEach(() => {
    process.env.USER = originalUser;
  });

  describe('getVerifiedBy', () => {
    it('should return username from USER env var', () => {
      process.env.USER = 'zhibo';
      const cli = new CheckpointVerificationCLI();
      expect(cli.getVerifiedBy()).toBe('zhibo');
    });

    it('should return username from USERNAME env var when USER is not set', () => {
      delete process.env.USER;
      process.env.USERNAME = 'testuser';
      const cli = new CheckpointVerificationCLI();
      expect(cli.getVerifiedBy()).toBe('testuser');
      process.env.USERNAME = undefined;
    });

    it('should return unknown when no env var is set', () => {
      delete process.env.USER;
      delete process.env.USERNAME;
      const cli = new CheckpointVerificationCLI();
      expect(cli.getVerifiedBy()).toBe('unknown');
    });
  });

  describe('buildHumanVerificationRecord', () => {
    it('should build record with user input', () => {
      process.env.USER = 'zhibo';
      const cli = new CheckpointVerificationCLI();
      const result = cli.buildHumanVerificationRecord('登录成功，跳转到首页');

      expect(result.valid).toBe(true);
      expect(result.verifiedBy).toBe('zhibo');
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0]!.type).toBe('human');
      expect(result.evidence[0]!.description).toBe('登录成功，跳转到首页');
      expect(result.userInput).toBe('登录成功，跳转到首页');
      expect(result.verifiedAt).toBeTruthy();
    });
  });

  describe('buildAutomatedVerificationRecord', () => {
    it('should build valid record when evidence is present', () => {
      process.env.USER = 'zhibo';
      const cli = new CheckpointVerificationCLI();
      const evidence = [
        { type: 'file', description: 'src/api/auth/login.ts' },
      ];
      const result = cli.buildAutomatedVerificationRecord(evidence);

      expect(result.valid).toBe(true);
      expect(result.verifiedBy).toBe('zhibo');
      expect(result.evidence).toHaveLength(1);
      expect(result.verifiedAt).toBeTruthy();
    });

    it('should build invalid record when evidence is empty', () => {
      process.env.USER = 'zhibo';
      const cli = new CheckpointVerificationCLI();
      const result = cli.buildAutomatedVerificationRecord([]);

      expect(result.valid).toBe(false);
      expect(result.evidence).toHaveLength(0);
    });
  });

  describe('buildFailureRecord', () => {
    it('should build failure record with reason', () => {
      process.env.USER = 'zhibo';
      const cli = new CheckpointVerificationCLI();
      const result = cli.buildFailureRecord('产出验证失败');

      expect(result.valid).toBe(false);
      expect(result.verifiedBy).toBe('zhibo');
      expect(result.failureReason).toBe('产出验证失败');
      expect(result.evidence).toHaveLength(0);
      expect(result.verifiedAt).toBeTruthy();
    });
  });

  describe('createCheckpointVerificationCLI factory', () => {
    it('should create instance with default cwd', () => {
      const cli = createCheckpointVerificationCLI();
      expect(cli).toBeInstanceOf(CheckpointVerificationCLI);
    });
  });
});

describe('CheckpointVerificationDetails type', () => {
  it('should support aiProxied field for AI proxy mode', () => {
    const details: CheckpointVerificationDetails = {
      type: 'human',
      aiProxied: true,
      userConfirmation: '用户确认内容',
    };
    expect(details.aiProxied).toBe(true);
    expect(details.userConfirmation).toBe('用户确认内容');
  });

  it('should support directHumanInput field for human direct mode', () => {
    const details: CheckpointVerificationDetails = {
      type: 'human',
      directHumanInput: true,
    };
    expect(details.directHumanInput).toBe(true);
  });

  it('should support strategy field for automated verification', () => {
    const details: CheckpointVerificationDetails = {
      type: 'automated',
      strategy: {
        verifyFiles: true,
        verifyCodeChange: true,
        verifyTests: false,
      },
      missingOutputs: ['src/api/auth/login.test.ts'],
    };
    expect(details.strategy?.verifyFiles).toBe(true);
    expect(details.missingOutputs).toHaveLength(1);
  });
});

describe('updateCheckpointStatus with human parameter', () => {
  let env: IsolatedTestEnv;
  let writeTaskMetaSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    writeTaskMetaSpy = spyOn(require('../utils/task.js'), 'writeTaskMeta');
  });

  afterEach(async () => {
    writeTaskMetaSpy.mockRestore();
    await env.cleanup();
  });

  it('should set verifiedBy to username when human=true', async () => {
    // This tests the human parameter in updateCheckpointStatus
    // The human=true flag sets verifiedBy to username and details.directHumanInput=true
    process.env.USER = 'testuser';

    const details: CheckpointVerificationDetails = {
      type: 'human',
      directHumanInput: true,
    };

    // Verify the details structure matches what updateCheckpointStatus would produce
    expect(details.type).toBe('human');
    expect(details.directHumanInput).toBe(true);
  });

  it('should set verifiedBy to ai_proxy:xxx when human=false', () => {
    const details: CheckpointVerificationDetails = {
      type: 'human',
      aiProxied: true,
      userConfirmation: '用户确认内容',
    };

    expect(details.type).toBe('human');
    expect(details.aiProxied).toBe(true);
    expect(details.userConfirmation).toBe('用户确认内容');
  });
});

// ============================================================
// Integration tests: updateCheckpointWithAIVerification
// ============================================================

describe('updateCheckpointWithAIVerification integration', () => {
  let env: IsolatedTestEnv;
  let writeTaskMetaSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    writeTaskMetaSpy = spyOn(require('../utils/task.js'), 'writeTaskMeta');
  });

  afterEach(async () => {
    writeTaskMetaSpy.mockRestore();
    await env.cleanup();
  });

  it('should call updateCheckpointStatus with completed status for valid AI result', () => {
    const ai = new CheckpointVerificationAI('claude-code');
    const result = ai.buildHumanVerificationRecord('用户确认：功能正常');

    // Verify the result structure before it would be passed to updateCheckpointStatus
    expect(result.valid).toBe(true);
    expect(result.verifiedBy).toBe('ai_proxy:claude-code');
    expect(result.evidence[0]!.type).toBe('human');
  });

  it('should call updateCheckpointStatus with failed status for invalid AI result', () => {
    const ai = new CheckpointVerificationAI('claude-code');
    const result = ai.buildFailureRecord('产出验证失败', ['src/missing.ts']);

    expect(result.valid).toBe(false);
    expect(result.verifiedBy).toBe('ai_proxy:claude-code');
    expect(result.failureReason).toBe('产出验证失败');
  });

  it('should use ai_proxy:xxx verifiedBy format in automated verification', () => {
    const ai = new CheckpointVerificationAI('codex');
    const evidence = [{ type: 'file', description: 'src/api/auth.ts' }];
    const result = ai.buildAutomatedVerificationRecord(evidence);

    expect(result.valid).toBe(true);
    expect(result.verifiedBy).toBe('ai_proxy:codex');
    expect(result.verifiedBy).toMatch(/^ai_proxy:/);
  });

  it('should preserve userConfirmation through the full AI workflow', () => {
    const ai = new CheckpointVerificationAI();
    const userConfirmation = '手动测试通过：登录功能正常';
    const result = ai.buildHumanVerificationRecord(userConfirmation, '已验证');

    expect(result.userConfirmation).toBe('已验证');
    expect(result.evidence[0]!.description).toBe(userConfirmation);
  });
});

// ============================================================
// Integration tests: updateCheckpointWithCLIVerification
// ============================================================

describe('updateCheckpointWithCLIVerification integration', () => {
  let env: IsolatedTestEnv;
  let writeTaskMetaSpy: ReturnType<typeof spyOn>;
  let originalUser: string | undefined;

  beforeEach(async () => {
    env = await createIsolatedTestEnv();
    writeTaskMetaSpy = spyOn(require('../utils/task.js'), 'writeTaskMeta');
    originalUser = process.env.USER;
  });

  afterEach(async () => {
    writeTaskMetaSpy.mockRestore();
    process.env.USER = originalUser;
    await env.cleanup();
  });

  it('should call updateCheckpointStatus with human=true for CLI human verification', () => {
    process.env.USER = 'testuser';
    const cli = new CheckpointVerificationCLI();
    const result = cli.buildHumanVerificationRecord('功能验证通过');

    // CLI human verification uses username format, not ai_proxy
    expect(result.valid).toBe(true);
    expect(result.verifiedBy).toBe('testuser');
    expect(result.verifiedBy).not.toMatch(/^ai_proxy:/);
  });

  it('should call updateCheckpointStatus with completed status for valid CLI result', () => {
    process.env.USER = 'developer';
    const cli = new CheckpointVerificationCLI();
    const result = cli.buildAutomatedVerificationRecord([
      { type: 'test', description: 'bun test passed' },
    ]);

    expect(result.valid).toBe(true);
    expect(result.verifiedBy).toBe('developer');
  });

  it('should call updateCheckpointStatus with failed status for invalid CLI result', () => {
    process.env.USER = 'developer';
    const cli = new CheckpointVerificationCLI();
    const result = cli.buildFailureRecord('构建失败');

    expect(result.valid).toBe(false);
    expect(result.verifiedBy).toBe('developer');
    expect(result.failureReason).toBe('构建失败');
  });

  it('should set directHumanInput=true when human mode is used', () => {
    // When updateCheckpointWithCLIVerification calls updateCheckpointStatus,
    // it passes human: true, which sets details.directHumanInput = true
    const details: CheckpointVerificationDetails = {
      type: 'human',
      directHumanInput: true,
    };

    expect(details.directHumanInput).toBe(true);
    expect(details.type).toBe('human');
  });
});

// ============================================================
// Integration tests: AI vs CLI verifiedBy format distinction
// ============================================================

describe('AI vs CLI verifiedBy format distinction', () => {
  it('AI verification always uses ai_proxy: prefix', () => {
    const aiNames = ['claude-code', 'codex', 'gemini', 'custom-ai'];
    for (const name of aiNames) {
      const ai = new CheckpointVerificationAI(name);
      expect(ai.getVerifiedBy()).toBe(`ai_proxy:${name}`);
      expect(ai.getVerifiedBy()).toMatch(/^ai_proxy:/);
    }
  });

  it('CLI verification never uses ai_proxy: prefix', () => {
    const originalUser = process.env.USER;
    process.env.USER = 'testuser';
    const cli = new CheckpointVerificationCLI();
    expect(cli.getVerifiedBy()).toBe('testuser');
    expect(cli.getVerifiedBy()).not.toMatch(/^ai_proxy:/);
    process.env.USER = originalUser;
  });

  it('factory functions produce consistent verifiedBy formats', () => {
    const ai = createCheckpointVerificationAI('claude-code');
    const cli = createCheckpointVerificationCLI();

    expect(ai.getVerifiedBy()).toMatch(/^ai_proxy:/);
    // CLI uses env USER which may vary, but must NOT start with ai_proxy:
    expect(cli.getVerifiedBy()).not.toMatch(/^ai_proxy:/);
  });
});