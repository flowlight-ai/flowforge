import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  buildCredentialsFromEnv,
  buildProviderFromEnv,
  buildProtocolToolConfig,
  createProtocolTools,
  deriveFileName,
  deriveMimeType,
  loadProtocolsFromDir,
} from '../src/index.js';

const ASYNC_YAML = `name: video_gen
version: 1
mode: async
baseUrl: https://api.example.com
auth:
  method: apikey
  paramName: key
capabilities:
  text2video:
    submit:
      method: POST
      path: /submit
      response:
        taskId: $.id
        statusMap:
          queued: [QUEUED]
          running: [RUNNING, PROCESSING]
          succeeded: [done, SUCCEEDED]
          failed: [FAILED, ERROR]
    poll:
      method: GET
      path: /tasks/{taskId}
      interval: 1000
      maxAttempts: 2
      response:
        status: $.status
        resultUrl: $.url
`;

const SYNC_YAML = `name: echo
version: 1
mode: sync
baseUrl: https://api.example.com
auth:
  method: apikey
capabilities:
  text:
    request:
      method: POST
      path: /echo
      response:
        result: $.text
`;

const ENV_VARS = [
  'VIDEO_PROVIDER',
  'VIDEO_AUTH_TYPE',
  'VIDEO_BASE_URL',
  'VIDEO_MODEL',
  'VIDEO_API_KEY',
  'VIDEO_SECRET_KEY',
  'VIDEO_ACCESS_KEY',
];

function clearEnv() {
  for (const v of ENV_VARS) delete process.env[v];
}

describe('protocol fixtures + loadProtocolsFromDir + createProtocolTools', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-server-protocol-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    clearEnv();
  });

  function writeFixtures(tmpDir: string) {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'video_gen.yaml'), ASYNC_YAML);
    writeFileSync(join(tmpDir, 'echo.yml'), SYNC_YAML);
  }

  it('loads protocols from a fixture directory', () => {
    writeFixtures(dir);
    const templates = loadProtocolsFromDir(dir);
    expect([...templates.keys()].sort()).toEqual(['echo', 'video_gen']);
    expect(templates.get('video_gen')?.mode).toBe('async');
    expect(templates.get('echo')?.mode).toBe('sync');
  });

  it('creates submit+poll tools for an async protocol with zod schemas', () => {
    writeFixtures(dir);
    const templates = loadProtocolsFromDir(dir);
    const template = templates.get('video_gen')!;
    process.env.VIDEO_PROVIDER = 'video_gen';
    process.env.VIDEO_BASE_URL = 'https://api.example.com';
    process.env.VIDEO_API_KEY = 'secret-key';
    const provider = buildProviderFromEnv('VIDEO', template.baseUrl, template.auth?.method)!;
    const config = buildProtocolToolConfig('VIDEO', provider, template);
    const tools = createProtocolTools(config);
    expect(tools.map((t) => t.name)).toEqual(['video_submit', 'video_poll']);
    const submit = tools.find((t) => t.name === 'video_submit')!;
    expect(submit.inputSchema.capability instanceof z.ZodType).toBe(true);
    const poll = tools.find((t) => t.name === 'video_poll')!;
    expect(poll.inputSchema.task_id instanceof z.ZodType).toBe(true);
    expect(config.credentials.apiKey).toBe('secret-key');
    expect(config.credentials._authParamName).toBe('key');
  });

  it('creates an execute tool for a sync protocol', () => {
    writeFixtures(dir);
    const templates = loadProtocolsFromDir(dir);
    const template = templates.get('echo')!;
    process.env.VIDEO_PROVIDER = 'echo';
    process.env.VIDEO_BASE_URL = 'https://api.example.com';
    const provider = buildProviderFromEnv('VIDEO', template.baseUrl, template.auth?.method)!;
    const tools = createProtocolTools(buildProtocolToolConfig('VIDEO', provider, template));
    expect(tools.map((t) => t.name)).toEqual(['video_execute']);
  });
});

describe('buildProviderFromEnv / buildCredentialsFromEnv', () => {
  afterEach(clearEnv);

  it('returns null when the provider env var is absent', () => {
    expect(buildProviderFromEnv('VIDEO')).toBeNull();
  });

  it('builds a provider from a fixture process.env with auth precedence', () => {
    process.env.VIDEO_PROVIDER = 'video_gen';
    process.env.VIDEO_AUTH_TYPE = 'jwt-hs256';
    process.env.VIDEO_BASE_URL = 'https://provider.example.com';
    process.env.VIDEO_MODEL = 'ttv-1';
    const provider = buildProviderFromEnv('VIDEO', 'https://default.example.com', 'apikey');
    expect(provider).not.toBeNull();
    expect(provider!.authType).toBe('jwt-hs256'); // env wins over template default
    expect(provider!.baseUrl).toBe('https://provider.example.com');
    expect(provider!.model).toBe('ttv-1');
  });

  it('builds credentials from env, honoring api/secret/access key roles', () => {
    process.env.VIDEO_API_KEY = 'api-secret';
    process.env.VIDEO_SECRET_KEY = 'sec';
    process.env.VIDEO_ACCESS_KEY = 'acc';
    const creds = buildCredentialsFromEnv('VIDEO');
    expect(creds.apiKey).toBe('api-secret');
    expect(creds.secretKey).toBe('sec');
    expect(creds.accessKey).toBe('acc');
  });
});

describe('deriveFileName / deriveMimeType', () => {
  it('extracts basename + extension from a real URL', () => {
    expect(deriveFileName('https://cdn.example.com/out/abc.mp4', 'video_gen', '123')).toBe('abc.mp4');
    expect(deriveMimeType('https://cdn.example.com/out/abc.mp4')).toBe('video/mp4');
    expect(deriveMimeType('https://cdn.example.com/img.png', 'text2image')).toBe('image/png');
  });

  it('falls back to capability-derived name and mime when no extension', () => {
    expect(deriveFileName('https://cdn.example.com/start', 'video_gen', '321', 'text2image')).toBe('video_gen_321.png');
    expect(deriveMimeType('https://cdn.example.com/start', 'text2image')).toBe('image/png');
    expect(deriveMimeType('https://cdn.example.com/start', 'image2video')).toBe('video/mp4');
  });
});