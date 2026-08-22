/**
 * PredicateChecker — T7.24 SOP 谓词检查器核心语义验证。
 *
 * 对齐 Python `sop/predicate.py`：8 内置检查器 + register 扩展 +
 * applyContext 五后处理（command_pattern / command_sequence /
 * handle_check / sha_dedup / feature_doc）。命令执行经 RunCommandFn
 * 注入，环境变量经 env 注入，避免真实 subprocess。
 *
 * @module @flowforge/forgekin-sop/tests
 */

import { describe, expect, it } from 'vitest';
import { makePredicateConfig, PredicateResult, PredicateType } from '../src/models.js';
import { CommandOutcome, PredicateChecker, RunCommandFn } from '../src/predicate.js';

/** 构造脚本化假命令执行器：按命令首两参路由 */
function fakeRunCommand(
  script: Record<string, CommandOutcome>,
): RunCommandFn {
  return async (cmd) => {
    const key = `${cmd[0]} ${cmd[1]}`;
    return script[key] ?? { code: -1, stdout: '', stderr: `unexpected command: ${key}` };
  };
}

const GIT_OK: Record<string, CommandOutcome> = {
  'git rev-parse': { code: 0, stdout: 'main', stderr: '' },
  'git rev-list': { code: 0, stdout: '0\t0', stderr: '' },
  'git status': { code: 0, stdout: '', stderr: '' },
};

describe('manual_only', () => {
  it('恒 passed=true，附默认 reason', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(makePredicateConfig({ type: PredicateType.MANUAL_ONLY }));
    expect(result.passed).toBe(true);
    expect(result.message).toBe('manual check: manual check required');
    expect(result.evidence.automated).toBe(false);
  });

  it('使用配置的 reason', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(
      makePredicateConfig({ type: PredicateType.MANUAL_ONLY, reason: '人工确认 spec' }),
    );
    expect(result.message).toBe('manual check: 人工确认 spec');
    expect(result.evidence.reason).toBe('人工确认 spec');
  });
});

describe('git_state_predicate', () => {
  it('ahead/behind 为零且工作区干净 → 通过', async () => {
    const checker = new PredicateChecker({
      runCommand: fakeRunCommand(GIT_OK),
    });
    const result = await checker.check(
      makePredicateConfig({
        type: PredicateType.GIT_STATE_PREDICATE,
        checks: ['ahead_zero', 'behind_zero', 'clean'],
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.message).toBe('git state OK on branch main');
    expect(result.evidence.ahead).toBe(0);
    expect(result.evidence.behind).toBe(0);
    expect(result.evidence.clean).toBe(true);
  });

  it('本地领先远端 → 阻断', async () => {
    const checker = new PredicateChecker({
      runCommand: fakeRunCommand({
        ...GIT_OK,
        'git rev-list': { code: 0, stdout: '0\t3', stderr: '' },
      }),
    });
    const result = await checker.check(
      makePredicateConfig({ type: PredicateType.GIT_STATE_PREDICATE }),
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('ahead of origin/main by 3 commits');
  });

  it('工作区脏 → clean 检查失败', async () => {
    const checker = new PredicateChecker({
      runCommand: fakeRunCommand({
        ...GIT_OK,
        'git status': { code: 0, stdout: 'M file.ts', stderr: '' },
      }),
    });
    const result = await checker.check(
      makePredicateConfig({
        type: PredicateType.GIT_STATE_PREDICATE,
        checks: ['clean'],
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('uncommitted changes');
  });

  it('git 不可用 → rev-parse 失败即阻断', async () => {
    const checker = new PredicateChecker({
      runCommand: fakeRunCommand({
        'git rev-parse': { code: 128, stdout: '', stderr: 'not a git repo' },
      }),
    });
    const result = await checker.check(
      makePredicateConfig({ type: PredicateType.GIT_STATE_PREDICATE }),
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('failed to get current branch');
  });
});

describe('env_check', () => {
  it('无 env_vars → 直接通过', async () => {
    const checker = new PredicateChecker({ env: {} });
    const result = await checker.check(
      makePredicateConfig({ type: PredicateType.ENV_CHECK }),
    );
    expect(result.passed).toBe(true);
    expect(result.message).toBe('no env vars to check');
  });

  it('全部存在 → 通过', async () => {
    const checker = new PredicateChecker({ env: { FOO: '1', BAR: '2' } });
    const result = await checker.check(
      makePredicateConfig({ type: PredicateType.ENV_CHECK, envVars: ['FOO', 'BAR'] }),
    );
    expect(result.passed).toBe(true);
    expect(result.message).toBe('all 2 env vars present');
  });

  it('缺失/空值 → 阻断并列出 missing', async () => {
    const checker = new PredicateChecker({ env: { FOO: '', BAR: 'x' } });
    const result = await checker.check(
      makePredicateConfig({ type: PredicateType.ENV_CHECK, envVars: ['FOO', 'BAR', 'BAZ'] }),
    );
    expect(result.passed).toBe(false);
    expect(result.message).toBe('missing env vars: FOO, BAZ');
  });
});

describe('command_pattern', () => {
  const config = makePredicateConfig({
    type: PredicateType.COMMAND_PATTERN,
    mustMatch: '^git\\s',
    mustNotMatch: 'force',
  });

  it('无 pattern 约束 → 直接通过', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(
      makePredicateConfig({ type: PredicateType.COMMAND_PATTERN }),
    );
    expect(result.passed).toBe(true);
    expect(result.message).toBe('no patterns to check');
  });

  it('无上下文 → 提示需要运行时上下文（passed=true）', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('requires runtime context');
  });

  it('空 context 不触发后处理（对齐 Python `if context:` 假值语义）', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, {});
    expect(result.passed).toBe(true);
    expect(result.message).toContain('requires runtime context');
  });

  it('context 缺 last_command → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, { other: 1 });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('no last_command in context');
  });

  it('last_command 匹配 must_match 且未触 must_not_match → 通过', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, { last_command: 'git status' });
    expect(result.passed).toBe(true);
    expect(result.message).toContain('command pattern OK');
  });

  it('不匹配 must_match → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, { last_command: 'rm -rf /' });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('does not match required pattern');
  });

  it('命中 must_not_match → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, { last_command: 'git push --force' });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('matches forbidden pattern');
  });
});

describe('command_sequence', () => {
  const config = makePredicateConfig({
    type: PredicateType.COMMAND_SEQUENCE,
    mustInclude: ['pnpm test'],
    antiPattern: ['rm -rf'],
    cwdContains: 'flowforge',
  });

  it('无约束 → 直接通过', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(
      makePredicateConfig({ type: PredicateType.COMMAND_SEQUENCE }),
    );
    expect(result.passed).toBe(true);
    expect(result.message).toBe('no sequence constraints to check');
  });

  it('全部满足 → 通过', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, {
      command_history: ['pnpm test --run', 'git add .'],
      cwd: '/work/flowforge',
    });
    expect(result.passed).toBe(true);
    expect(result.message).toBe('command sequence OK');
  });

  it('cwd 不含子串 → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, {
      command_history: ['pnpm test'],
      cwd: '/work/other',
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain("does not contain 'flowforge'");
  });

  it('must_include 缺失 → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, {
      command_history: ['git add .'],
      cwd: '/work/flowforge',
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('missing required commands');
  });

  it('anti_pattern 出现 → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, {
      command_history: ['pnpm test', 'rm -rf node_modules'],
      cwd: '/work/flowforge',
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('forbidden commands');
  });
});

describe('handle_check', () => {
  it('无 constraint → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(
      makePredicateConfig({ type: PredicateType.HANDLE_CHECK }),
    );
    expect(result.passed).toBe(false);
    expect(result.message).toBe('no handle constraint specified');
  });

  it('未知 constraint → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(
      makePredicateConfig({ type: PredicateType.HANDLE_CHECK, constraint: 'weird' }),
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('unknown handle constraint');
  });

  it('reviewer_not_author：reviewer 与 author 相同 → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(
      makePredicateConfig({
        type: PredicateType.HANDLE_CHECK,
        constraint: 'reviewer_not_author',
      }),
      { author: 'alice', reviewer: 'alice' },
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('same as author');
  });

  it('reviewer_not_author：缺 author/reviewer → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(
      makePredicateConfig({
        type: PredicateType.HANDLE_CHECK,
        constraint: 'reviewer_not_author',
      }),
      { author: 'alice' },
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('requires both author and reviewer');
  });

  it('reviewer_not_author：不同 → 通过', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(
      makePredicateConfig({
        type: PredicateType.HANDLE_CHECK,
        constraint: 'reviewer_not_author',
      }),
      { author: 'alice', reviewer: 'bob' },
    );
    expect(result.passed).toBe(true);
  });

  it('guardian_handoff_present：guardian 独立 → 通过', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(
      makePredicateConfig({
        type: PredicateType.HANDLE_CHECK,
        constraint: 'guardian_handoff_present',
      }),
      { author: 'alice', reviewer: 'bob', guardian: 'carol' },
    );
    expect(result.passed).toBe(true);
  });

  it('guardian_handoff_present：guardian 即 author → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(
      makePredicateConfig({
        type: PredicateType.HANDLE_CHECK,
        constraint: 'guardian_handoff_present',
      }),
      { author: 'alice', reviewer: 'bob', guardian: 'alice' },
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('same as author');
  });
});

describe('sha_dedup', () => {
  const config = makePredicateConfig({ type: PredicateType.SHA_DEDUP });

  it('缺 current_sha → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, { seen_shas: [] });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('requires current_sha');
  });

  it('已处理过的 sha → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, {
      current_sha: 'abc123',
      seen_shas: ['abc123'],
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('already been processed');
  });

  it('新 sha → 通过', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, {
      current_sha: 'def456',
      seen_shas: ['abc123'],
    });
    expect(result.passed).toBe(true);
    expect(result.message).toContain('is new');
  });
});

describe('feature_doc_readiness_check', () => {
  const config = makePredicateConfig({ type: PredicateType.FEATURE_DOC_READINESS_CHECK });

  it('缺 feature_doc → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, { other: 1 });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('requires feature_doc');
  });

  it('feature_doc 非对象 → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, { feature_doc: 'not-a-dict' });
    expect(result.passed).toBe(false);
    expect(result.message).toBe('feature_doc must be a dict');
  });

  it('缺必需键 → 失败', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, {
      feature_doc: { acceptance_criteria: [] },
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('missing required keys');
    expect(result.message).toContain('requirements');
  });

  it('含 acceptance_criteria + requirements → 通过', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(config, {
      feature_doc: { acceptance_criteria: ['ac1'], requirements: ['r1'] },
    });
    expect(result.passed).toBe(true);
    expect(result.message).toBe('feature doc is ready');
  });
});

describe('路由与扩展', () => {
  it('未注册 type → passed=false', async () => {
    const checker = new PredicateChecker();
    const result = await checker.check(
      makePredicateConfig({ type: 'rocket_gate' as PredicateType }),
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('no checker registered');
  });

  it('检查器抛异常 → passed=false + exception evidence', async () => {
    const checker = new PredicateChecker();
    checker.register('boom', async () => {
      throw new Error('kaput');
    });
    const result = await checker.check(
      makePredicateConfig({ type: 'boom' as PredicateType }),
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain('checker exception: kaput');
    expect(result.evidence.exception).toBe('kaput');
  });

  it('register 覆盖内置检查器', async () => {
    const checker = new PredicateChecker();
    checker.register(PredicateType.MANUAL_ONLY, async (): Promise<PredicateResult> => ({
      passed: false,
      message: 'custom override',
      evidence: {},
    }));
    const result = await checker.check(
      makePredicateConfig({ type: PredicateType.MANUAL_ONLY }),
    );
    expect(result.passed).toBe(false);
    expect(result.message).toBe('custom override');
  });
});
