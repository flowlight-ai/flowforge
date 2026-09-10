import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  initRepoIdentity,
  isSameRepo,
  normalizeErrorMessage,
  normalizeJsonUnicode,
  readJsonlTail,
  resolveExternalUrl,
  scoreKeywordRelevance,
  tcpProbe,
  tokenizeKeyword,
  validateExternalUrl,
} from '../src/index.ts'

describe('readJsonlTail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-jsonltail-'))
  const file = join(dir, 'events.jsonl')

  beforeAll(() => {
    writeFileSync(
      file,
      ['{"seq":1,"ok":false}', 'not json', '{"seq":2,"ok":true}', '{"seq":3,"ok":true}', ''].join('\n'),
      'utf-8',
    )
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('returns the newest line matching the predicate', () => {
    const hit = readJsonlTail<{ seq: number }>(file, { predicate: (v) => (v as { ok?: boolean }).ok === true })
    expect(hit?.seq).toBe(3)
  })

  it('returns undefined when nothing matches', () => {
    const hit = readJsonlTail(file, { predicate: (v) => (v as { seq?: number }).seq === 99 })
    expect(hit).toBeUndefined()
  })

  it('skips malformed JSON lines', () => {
    const hit = readJsonlTail<{ seq: number }>(file, { predicate: (v) => v !== null })
    expect(hit?.seq).toBe(3)
  })

  it('returns undefined for a missing file', () => {
    expect(readJsonlTail(join(dir, 'nope.jsonl'), { predicate: () => true })).toBeUndefined()
  })
})

describe('normalizeJsonUnicode', () => {
  it('preserves well-formed surrogate pairs', () => {
    const emoji = 'a\u{1F600}b'
    expect(normalizeJsonUnicode(emoji)).toBe(emoji)
  })

  it('replaces an isolated high surrogate with U+FFFD', () => {
    const bad = `x\uD800y`
    expect(normalizeJsonUnicode(bad)).toBe('x\uFFFDy')
  })

  it('normalizes nested records and arrays without mutating input', () => {
    const input = { a: `\uDD00`, list: [`ok`, `z\uD801`] }
    const out = normalizeJsonUnicode(input)
    expect(out.a).toBe('\uFFFD')
    expect(out.list).toEqual(['ok', 'z\uFFFD'])
    expect(input.list).toEqual(['ok', `z\uD801`])
  })

  it('returns a well-formed value unchanged', () => {
    const input = { a: 1, b: ['x'] }
    expect(normalizeJsonUnicode(input)).toBe(input)
  })
})

describe('normalizeErrorMessage', () => {
  it('reads the message from an Error', () => {
    expect(normalizeErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('passes strings through', () => {
    expect(normalizeErrorMessage('plain')).toBe('plain')
  })

  it('reads a string .message from a plain object', () => {
    expect(normalizeErrorMessage({ message: 'obj msg' })).toBe('obj msg')
  })

  it('serializes unknown objects', () => {
    expect(normalizeErrorMessage({ code: 42 })).toBe('{"code":42}')
  })

  it('returns a stable fallback for hostile values', () => {
    const hostile = Object.create(null) as unknown
    expect(typeof normalizeErrorMessage(hostile)).toBe('string')
  })
})

describe('tcpProbe', () => {
  it('resolves true for an open port', async () => {
    const server = createServer((sock) => sock.destroy())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      await expect(tcpProbe('127.0.0.1', port, 1000)).resolves.toBe(true)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('resolves false for a closed port', async () => {
    await expect(tcpProbe('127.0.0.1', 1, 1000)).resolves.toBe(false)
  })
})

describe('isSameRepo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-samerepo-'))

  beforeAll(() => {
    mkdirSync(join(dir, 'sub'), { recursive: true })
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('returns true for identical paths without invoking git', () => {
    expect(isSameRepo(dir, dir)).toBe(true)
  })

  it('returns false for separate non-repo directories', () => {
    expect(isSameRepo(join(dir, 'sub'), dir)).toBe(false)
  })

  it('initRepoIdentity warms the cache without throwing outside a repo', () => {
    expect(() => initRepoIdentity(dir)).not.toThrow()
  })
})

describe('keyword relevance', () => {
  it('tokenizeKeyword splits and lowercases terms', () => {
    expect(tokenizeKeyword('  Alpha  BETA ')).toEqual(['alpha', 'beta'])
  })

  it('scores full matches as 1 and partial matches proportionally', () => {
    expect(scoreKeywordRelevance('alpha beta', ['alpha', 'beta'])).toBe(1)
    expect(scoreKeywordRelevance('alpha only', ['alpha', 'beta'])).toBe(0.5)
    expect(scoreKeywordRelevance('none here', ['alpha'])).toBe(0)
  })

  it('scores 0 for an empty term list', () => {
    expect(scoreKeywordRelevance('anything', [])).toBe(0)
  })
})

describe('url-safety: validateExternalUrl', () => {
  it('accepts a public IPv4 literal', () => {
    expect(validateExternalUrl('https://93.184.216.34/path').hostname).toBe('93.184.216.34')
  })

  it('rejects loopback addresses', () => {
    expect(() => validateExternalUrl('http://127.0.0.1')).toThrow(/private|reserved/)
  })

  it('rejects private IPv4 ranges', () => {
    expect(() => validateExternalUrl('https://10.1.2.3')).toThrow(/private|reserved/)
    expect(() => validateExternalUrl('https://192.168.0.5')).toThrow(/private|reserved/)
  })

  it('rejects blocked hostnames', () => {
    expect(() => validateExternalUrl('http://localhost')).toThrow(/blocked/)
    expect(() => validateExternalUrl('http://metadata.google.internal')).toThrow(/blocked/)
  })

  it('rejects non-http protocol', () => {
    expect(() => validateExternalUrl('ftp://example.com/file')).toThrow(/protocol/)
  })

  it('rejects malformed urls', () => {
    expect(() => validateExternalUrl('not a url')).toThrow(/Invalid URL/)
  })
})

describe('url-safety: resolveExternalUrl', () => {
  it('pins a hostname to a public address via injected DNS', async () => {
    const dnsLookup = async () => [{ address: '93.184.216.34' }]
    const resolved = await resolveExternalUrl('https://example.com/a', dnsLookup)
    expect(resolved.address).toBe('93.184.216.34')
    expect(resolved.url.hostname).toBe('example.com')
  })

  it('rejects hostnames resolving into private ranges', async () => {
    const dnsLookup = async () => [{ address: '10.0.0.1' }]
    await expect(resolveExternalUrl('https://example.com/a', dnsLookup)).rejects.toThrow(/private|reserved/)
  })

  it('rejects hostnames that cannot be resolved', async () => {
    const dnsLookup = async () => []
    await expect(resolveExternalUrl('https://example.com/a', dnsLookup)).rejects.toThrow(/could not be resolved/)
  })
})