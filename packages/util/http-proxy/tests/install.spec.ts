import { afterEach, describe, expect, it } from 'vitest'
import {
  clearedProxyEnv,
  installProxyFromEnvironment,
  proxyEnvironmentForChild,
  proxyRouteFor,
} from '../src/index.ts'
import { PROXY_ENV_NAMES } from '../src/policy.ts'

const proxyUrl = 'http://127.0.0.1:7897'
const nestedUrl = 'http://127.0.0.1:9'

/** A launch environment built from the names a user would export, in the casings they wrote. */
function env(values: Record<string, string>): { get(name: string): { value: string } | undefined } {
  return { get: name => (name in values ? { value: values[name] as string } : undefined) }
}

/** The environment of a user who exported one proxy for both schemes. */
function proxyAll(noProxy?: string): { get(name: string): { value: string } | undefined } {
  return env({ HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ...noProxy === undefined ? {} : { NO_PROXY: noProxy } })
}

/** Install and collect whatever the resolution reported, so a case can assert on both. */
async function install(
  lookup: { get(name: string): { value: string } | undefined },
): Promise<{ dispose: () => Promise<void>; reported: string[] }> {
  const reported: string[] = []
  const dispose = await installProxyFromEnvironment(lookup, (message) => { reported.push(message) })
  return { dispose, reported }
}

/** Run one case from a known-empty proxy environment, then restore what the machine had. */
async function withCleanProxyEnv(run: () => Promise<void>): Promise<void> {
  const saved = Object.fromEntries(PROXY_ENV_NAMES.map(name => [name, process.env[name]]))
  for (const name of PROXY_ENV_NAMES) Reflect.deleteProperty(process.env, name)
  try {
    await run()
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(process.env, name)
      else process.env[name] = value
    }
  }
}

afterEach(() => {
  for (const name of [...PROXY_ENV_NAMES, 'NODE_USE_ENV_PROXY']) Reflect.deleteProperty(process.env, name)
})

describe('installProxyFromEnvironment', () => {
  it('publishes the policy through the proxy environment in both casings', async () => {
    const { dispose } = await install(proxyAll('example.com'))
    try {
      expect(process.env.http_proxy).toBe(proxyUrl)
      expect(process.env.HTTP_PROXY).toBe(proxyUrl)
      expect(process.env.https_proxy).toBe(proxyUrl)
      expect(process.env.no_proxy).toContain('example.com')
      expect(process.env.NO_PROXY).toContain('example.com')
    } finally {
      await dispose()
    }
  })

  it('removes an environment name the policy leaves unset', async () => {
    // HTTPS names a proxy this package refuses, so that scheme stays direct and the stale name is
    // removed rather than carried from an earlier process.
    process.env.HTTPS_PROXY = 'http://stale.example'
    const { dispose } = await install(env({ HTTP_PROXY: proxyUrl, HTTPS_PROXY: 'socks5://127.0.0.1:1080' }))
    try {
      expect(process.env.HTTPS_PROXY).toBeUndefined()
    } finally {
      await dispose()
      expect(process.env.HTTPS_PROXY).toBe('http://stale.example')
      delete process.env.HTTPS_PROXY
    }
  })

  it('restores the environment on disposal', async () => {
    const beforeEnv = process.env.HTTP_PROXY
    const { dispose } = await install(proxyAll())
    expect(process.env.HTTP_PROXY).toBe(proxyUrl)
    await dispose()
    expect(process.env.HTTP_PROXY).toBe(beforeEnv)
  })

  it('installs nothing and touches no environment when the user exported none', async () => {
    process.env.HTTP_PROXY = 'http://untouched.example'
    const { dispose, reported } = await install(env({}))
    try {
      expect(process.env.HTTP_PROXY).toBe('http://untouched.example')
      expect(reported).toEqual([])
    } finally {
      await dispose()
      delete process.env.HTTP_PROXY
    }
  })

  it('reports a value it cannot use and installs the rest', async () => {
    const { dispose, reported } = await install(env({ HTTP_PROXY: proxyUrl, HTTPS_PROXY: 'socks5://127.0.0.1:1080' }))
    try {
      expect(reported).toHaveLength(1)
      expect(reported[0]).toContain('HTTPS_PROXY')
      expect(reported[0]).toContain('SOCKS')
      expect(reported[0]).not.toContain('1080')
      expect(process.env.HTTP_PROXY).toBe(proxyUrl)
      expect(process.env.HTTPS_PROXY).toBeUndefined()
    } finally {
      await dispose()
    }
  })
})

describe('proxyRouteFor', () => {
  it('proxies a non-bypassed URL and is direct with nothing installed or bypassed', async () => {
    const { dispose } = await install(proxyAll())
    try {
      expect(proxyRouteFor(new URL('http://example.com/'))).toEqual({ proxied: true, proxy: proxyUrl })
      expect(proxyRouteFor(new URL('https://example.com/'))).toEqual({ proxied: true, proxy: proxyUrl })
    } finally {
      await dispose()
    }
    expect(proxyRouteFor(new URL('http://example.com/'))).toEqual({ proxied: false })
  })

  it('is direct for a bypassed URL and for loopback', async () => {
    const { dispose } = await install(proxyAll('origin.test'))
    try {
      expect(proxyRouteFor(new URL('http://origin.test/'))).toEqual({ proxied: false })
      expect(proxyRouteFor(new URL('http://127.0.0.1:3000/'))).toEqual({ proxied: false })
    } finally {
      await dispose()
    }
  })
})

describe('proxyEnvironmentForChild', () => {
  it('is empty when no policy is installed', () => {
    expect(proxyEnvironmentForChild()).toEqual({})
  })

  it('is empty when the user exported none, so a child sees no flag it cannot use', async () => {
    const { dispose } = await install(env({}))
    try {
      expect(proxyEnvironmentForChild()).toEqual({})
    } finally {
      await dispose()
    }
  })

  it("hands a child the values the user exported, not this process's normalization", async () => {
    await withCleanProxyEnv(async () => {
      process.env.HTTP_PROXY = proxyUrl
      process.env.https_proxy = 'socks5://127.0.0.1:1080'
      const { dispose } = await install(env({ HTTP_PROXY: proxyUrl, https_proxy: 'socks5://127.0.0.1:1080', NO_PROXY: 'example.com' }))
      try {
        const child = proxyEnvironmentForChild()
        const https = [child.https_proxy, child.HTTPS_PROXY]
        expect(https).toContain('socks5://127.0.0.1:1080')
        expect(https).not.toContain(proxyUrl)
        expect(child.HTTP_PROXY).toBe(proxyUrl)
        expect(child.no_proxy).toBe('example.com,localhost,127.0.0.1,::1,[::1]')
        expect(child.NODE_USE_ENV_PROXY).toBeUndefined()
      } finally {
        await dispose()
      }
    })
  })

  it('fills a scheme the user named in neither casing, so a child Node is not left direct', async () => {
    await withCleanProxyEnv(async () => {
      process.env.ALL_PROXY = proxyUrl
      const { dispose } = await install(env({ ALL_PROXY: proxyUrl }))
      try {
        const child = proxyEnvironmentForChild()
        expect(child.HTTP_PROXY).toBe(proxyUrl)
        expect(child.http_proxy).toBe(proxyUrl)
        expect(child.HTTPS_PROXY).toBe(proxyUrl)
        expect(child.NODE_USE_ENV_PROXY).toBe('1')
      } finally {
        await dispose()
      }
    })
  })

  it('withholds NODE_USE_ENV_PROXY when the child receives a refused proxy value', async () => {
    await withCleanProxyEnv(async () => {
      process.env.HTTP_PROXY = proxyUrl
      process.env.HTTPS_PROXY = 'socks5://127.0.0.1:1080'
      const { dispose } = await install(env({ HTTP_PROXY: proxyUrl, HTTPS_PROXY: 'socks5://127.0.0.1:1080' }))
      try {
        const child = proxyEnvironmentForChild()
        expect(child.HTTPS_PROXY).toBe('socks5://127.0.0.1:1080')
        expect(child.HTTP_PROXY).toBe(proxyUrl)
        expect(child).not.toHaveProperty('NODE_USE_ENV_PROXY')
      } finally {
        await dispose()
      }
    })
  })

  it("keeps the outermost install's record across a nested one", async () => {
    await withCleanProxyEnv(async () => {
      // The user exported one name, in one casing.
      process.env.HTTP_PROXY = proxyUrl
      const outer = await install(env({ HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: 'example.com' }))
      try {
        const inner = await install(env({ HTTP_PROXY: nestedUrl, HTTPS_PROXY: nestedUrl }))
        try {
          const child = proxyEnvironmentForChild()
          // The user named no HTTPS proxy, so this scheme carries whichever policy is active. Reading
          // the outer install's published environment as the user's would pin it to the outer proxy
          // instead — the one discriminator that does not depend on how a platform cases names.
          expect(child.https_proxy).toBe(nestedUrl)
          expect(child.HTTPS_PROXY).toBe(nestedUrl)
        } finally {
          await inner.dispose()
        }
        // Unmounting the inner install must leave the outer one still able to describe the
        // environment it discovered.
        expect(proxyEnvironmentForChild().HTTP_PROXY).toBe(proxyUrl)
        expect(proxyEnvironmentForChild().https_proxy).toBe(proxyUrl)
      } finally {
        await outer.dispose()
      }
    })
  })
})

describe('publishing over a direct then proxied policy', () => {
  it('returns the user own values while a direct policy layers over a proxied one', async () => {
    await withCleanProxyEnv(async () => {
      process.env.HTTP_PROXY = proxyUrl
      const outer = await install(env({ HTTP_PROXY: proxyUrl }))
      try {
        expect(process.env.HTTP_PROXY).toBe(proxyUrl)
        const off = await install(env({}))
        try {
          // A direct policy returns the user's own environment, and the child overlay is empty.
          expect(process.env.HTTP_PROXY).toBe(proxyUrl)
          expect(proxyEnvironmentForChild()).toEqual({})
        } finally {
          await off.dispose()
        }
        // Ending the window re-applies what the outer install published.
        expect(process.env.HTTP_PROXY).toBe(proxyUrl)
        expect(proxyEnvironmentForChild().HTTP_PROXY).toBe(proxyUrl)
      } finally {
        await outer.dispose()
      }
    })
  })

  it('touches no environment when the install underneath proxied nothing', async () => {
    process.env.HTTP_PROXY = 'http://untouched.example'
    const outer = await install(env({}))
    const inner = await install(env({}))
    try {
      expect(process.env.HTTP_PROXY).toBe('http://untouched.example')
    } finally {
      await inner.dispose()
      await outer.dispose()
      expect(process.env.HTTP_PROXY).toBe('http://untouched.example')
      delete process.env.HTTP_PROXY
    }
  })
})

describe('the published environment', () => {
  it('restores every name from one snapshot taken before any write', async () => {
    process.env.http_proxy = 'http://before.example'
    process.env.HTTP_PROXY = 'http://before.example'
    const { dispose } = await install(proxyAll())
    expect(process.env.HTTP_PROXY).toBe(proxyUrl)
    await dispose()
    expect(process.env.http_proxy).toBe('http://before.example')
    expect(process.env.HTTP_PROXY).toBe('http://before.example')
    delete process.env.http_proxy
    delete process.env.HTTP_PROXY
  })
})

describe('clearedProxyEnv', () => {
  it('names every proxy variable for removal', () => {
    const cleared = clearedProxyEnv()
    expect(Object.keys(cleared).sort()).toEqual([...PROXY_ENV_NAMES].sort())
    expect(Object.values(cleared).every(value => value === undefined)).toBe(true)
  })
})