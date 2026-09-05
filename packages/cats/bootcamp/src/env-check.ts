/**
 * Bootcamp 环境检查（C8，clowder cats/services/bootcamp/env-check.ts 移植）。
 *
 * 检查 node/pnpm/git/各 CLI/MCP/本地服务端口是否就绪；CLI 探测与端口探测
 * 均注入式（测试确定性，不依赖真实命令与端口）。
 */

export interface EnvCheckItem {
  ok: boolean;
  version?: string;
  note?: string;
}

export interface EnvCheckResult {
  node: EnvCheckItem;
  pnpm: EnvCheckItem;
  git: EnvCheckItem;
  claudeCli: EnvCheckItem;
  codexCli: EnvCheckItem;
  geminiCli: EnvCheckItem;
  kimiCli: EnvCheckItem;
  mcp: EnvCheckItem;
  tts: { ok: boolean; recommended: string };
  asr: { ok: boolean };
  pencil: { ok: boolean; note: string };
}

/** CLI 探测：cmd 输出首行作为 version。 */
export type CommandProbe = (cmd: string) => Promise<EnvCheckItem>;

/** 端口探测。 */
export type PortProbe = (port: number) => Promise<boolean>;

export interface BootcampEnvCheckDeps {
  execCommand?: CommandProbe;
  checkPort?: PortProbe;
  /** MCP server 路径；undefined 时探测默认/环境变量。 */
  mcpServerPath?: string | null;
  env?: NodeJS.ProcessEnv;
}

const defaultCommandProbe: CommandProbe = async (cmd) => {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(execFile);
    const parts = cmd.split(/\s+/u);
    const [binary, ...args] = parts;
    if (!binary) return { ok: false };
    const { stdout } = (await execAsync(binary, args, { timeout: 5000 })) as { stdout: string };
    const version = stdout.trim().split('\n').at(0) ?? '';
    return version ? { ok: true, version } : { ok: true };
  } catch {
    return { ok: false };
  }
};

const defaultPortProbe: PortProbe = async (port) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(`http://localhost:${port}`, { signal: controller.signal });
      return response.ok || response.status < 500;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
};

function currentPnpmEnvironment(env: NodeJS.ProcessEnv): EnvCheckItem | null {
  const npmExecPath = env.npm_execpath?.toLowerCase() ?? '';
  const packageManagerUserAgent = env.npm_config_user_agent ?? '';
  const userAgentVersion = packageManagerUserAgent.match(/\bpnpm\/([^\s]+)/u)?.[1];

  if (!npmExecPath.includes('pnpm') && !userAgentVersion) {
    return null;
  }

  return userAgentVersion
    ? { ok: true, version: userAgentVersion, note: 'Detected from current package manager environment' }
    : { ok: true, note: 'Detected from current package manager environment' };
}

async function checkPnpm(deps: Required<Pick<BootcampEnvCheckDeps, 'execCommand'>>, env: NodeJS.ProcessEnv) {
  return currentPnpmEnvironment(env) ?? deps.execCommand('pnpm --version');
}

/** 运行完整环境检查。 */
export async function runEnvironmentCheck(deps: BootcampEnvCheckDeps = {}): Promise<EnvCheckResult> {
  const env = deps.env ?? process.env;
  const execCommand = deps.execCommand ?? defaultCommandProbe;
  const checkPort = deps.checkPort ?? defaultPortProbe;
  const resolveMcpPath = async (): Promise<string | null> => {
    if (deps.mcpServerPath !== undefined) return deps.mcpServerPath;
    const fromEnv = env.CAT_CAFE_MCP_SERVER_PATH?.trim() ?? env.FF_MCP_SERVER_PATH?.trim();
    return fromEnv ?? null;
  };

  const [node, pnpm, git, claudeCli, codexCli, geminiCli, kimiCli] = await Promise.all([
    execCommand('node --version'),
    checkPnpm({ execCommand }, env),
    execCommand('git --version'),
    execCommand('claude --version'),
    execCommand('codex --version'),
    execCommand('gemini --version'),
    execCommand('kimi --version'),
  ]);

  const mcpPath = await resolveMcpPath();
  const mcp: EnvCheckItem = mcpPath
    ? { ok: true, note: `MCP server found: ${mcpPath}` }
    : { ok: false, note: 'MCP server not found (packages/mcp-server/dist/index.js)' };

  const [ttsPort, asrPort] = await Promise.all([checkPort(9879), checkPort(9876)]);

  return {
    node,
    pnpm,
    git,
    claudeCli,
    codexCli,
    geminiCli,
    kimiCli,
    mcp,
    tts: {
      ok: ttsPort,
      recommended: ttsPort ? 'Qwen3-TTS 1.7B (已运行)' : 'Kokoro-82M (轻量推荐): mlx-community/Kokoro-82M-bf16',
    },
    asr: { ok: asrPort },
    pencil: { ok: false, note: '需要 Antigravity IDE + Pencil 扩展' },
  };
}
