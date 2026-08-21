/**
 * limb-yaml-loader — T6.4 插件四肢声明 YAML 加载契约验证。
 *
 * 覆盖（对齐 clowder-ai `src/domains/limb/limb-yaml-loader.ts` 语义）：
 * - 完整声明解析（rest/invoke 命令、auth、error、capabilities）
 * - 缺必填字段抛 Error；缺省值回退（type/auth 默认、tokenResponsePath）
 * - 可选字段不出现（baseUrl/auth/error 缺省时对象无该键）
 *
 * @module @flowforge/limb-embodiment/tests
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadLimbDeclaration } from '../src/limb-yaml-loader.ts';

const FULL_YAML = `nodeId: wechat-plugin
displayName: WeChat Plugin Limb
platform: linux-x64
baseUrl: https://api.wechat.example.com
capabilities:
  - cap: message
    commands: [message.send, message.recv]
    authLevel: free
auth:
  type: client_credentials
  tokenEndpoint: /cgi-bin/token
  tokenParams:
    grant_type: client_credential
    appid: ${'${WECHAT_APPID}'}
    secret: ${'${WECHAT_SECRET}'}
  tokenResponsePath: access_token
  tokenPlacement: query
  tokenParamName: access_token
  tokenExpiredCodes: [40001, 42001]
  ttlSeconds: 7200
error:
  codePath: errcode
  messagePath: errmsg
commands:
  send:
    type: rest
    description: Send a message
    endpoint: /cgi-bin/message/send
    method: POST
    params:
      touser:
        type: string
        required: true
      msgtype:
        type: string
        default: text
    body:
      touser: ${'${params.touser}'}
      msgtype: ${'${params.msgtype}'}
  health:
    type: invoke
    description: Health check
    params: {}
    handler: builtin:health_check
`;

const MINIMAL_YAML = `nodeId: bare-node
displayName: Bare Node
platform: win-x64
capabilities: []
commands:
  ping:
    type: invoke
    description: Ping
    params: {}
    handler: custom:ping
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'limb-yaml-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, 'utf-8');
  return p;
}

describe('loadLimbDeclaration', () => {
  it('解析完整声明：rest + invoke 命令、auth、error、capabilities', () => {
    const declaration = loadLimbDeclaration(write('full.yml', FULL_YAML));

    expect(declaration.nodeId).toBe('wechat-plugin');
    expect(declaration.displayName).toBe('WeChat Plugin Limb');
    expect(declaration.platform).toBe('linux-x64');
    expect(declaration.baseUrl).toBe('https://api.wechat.example.com');
    expect(declaration.capabilities).toEqual([
      { cap: 'message', commands: ['message.send', 'message.recv'], authLevel: 'free' },
    ]);

    expect(declaration.auth).toMatchObject({
      type: 'client_credentials',
      tokenEndpoint: '/cgi-bin/token',
      tokenResponsePath: 'access_token',
      tokenPlacement: 'query',
      tokenParamName: 'access_token',
      tokenExpiredCodes: [40001, 42001],
      ttlSeconds: 7200,
    });
    expect(declaration.error).toEqual({ codePath: 'errcode', messagePath: 'errmsg' });

    const send = declaration.commands['send'];
    expect(send?.type).toBe('rest');
    expect(send?.endpoint).toBe('/cgi-bin/message/send');
    expect(send?.method).toBe('POST');
    expect(send?.params['touser']).toEqual({ type: 'string', required: true });
    expect(send?.params['msgtype']).toEqual({ type: 'string', default: 'text' });

    const health = declaration.commands['health'];
    expect(health?.type).toBe('invoke');
    expect(health?.handler).toBe('builtin:health_check');
  });

  it('最小声明：可选字段缺省不出现，缺省值回退', () => {
    const declaration = loadLimbDeclaration(write('minimal.yml', MINIMAL_YAML));

    expect(declaration.baseUrl).toBeUndefined();
    expect(declaration.auth).toBeUndefined();
    expect(declaration.error).toBeUndefined();
    expect(declaration.commands['ping']).toMatchObject({ type: 'invoke', handler: 'custom:ping' });
    // type 缺省回退 rest
    expect(declaration.commands['ping']?.type).toBe('invoke');
  });

  it('缺 nodeId/displayName/platform/capabilities 抛 Error', () => {
    const p = write('bad.yml', 'displayName: Only Name\nplatform: linux\ncapabilities: []\ncommands: {}\n');
    expect(() => loadLimbDeclaration(p)).toThrow(/missing required fields/);
  });

  it('auth 缺省字段回退默认值', () => {
    const yaml = `nodeId: n
displayName: d
platform: p
capabilities: []
auth:
  tokenEndpoint: /token
commands: {}
`;
    const declaration = loadLimbDeclaration(write('auth.yml', yaml));
    expect(declaration.auth).toMatchObject({
      type: 'client_credentials',
      tokenResponsePath: 'access_token',
      tokenPlacement: 'query',
      tokenParamName: 'access_token',
      tokenExpiredCodes: [],
      ttlSeconds: 7200,
      tokenParams: {},
    });
  });

  it('commands 缺省为空对象', () => {
    const yaml = `nodeId: n
displayName: d
platform: p
capabilities: []
`;
    const declaration = loadLimbDeclaration(write('nocommands.yml', yaml));
    expect(declaration.commands).toEqual({});
  });

  it('非法 YAML 抛解析错误', () => {
    const p = write('broken.yml', 'nodeId: [unclosed\n');
    expect(() => loadLimbDeclaration(p)).toThrow();
  });
});
