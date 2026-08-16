import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@flowforge/cordis'
import { describe, expect, it } from 'vitest'
import SkillRegistry from '@flowforge/skill'
import * as SkillBadge from '@flowforge/skill-badge'

describe('flowforge-skill-badge', () => {
  it('registers and disposes the bundled badge skill', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(SkillBadge)
    const resourcePath = fileURLToPath(new URL('../assets/', import.meta.url))

    expect(await ctx.skills.list()).toEqual([{
      name: 'flowforge-badge',
      description: 'Add the official “powered by flowforge” badge to documents, pull requests, merge requests, and other content produced with FlowForge. Use whenever creating a pull request or merge request. Also use when the user asks for a flowforge badge, powered-by-flowforge attribution, or a reusable flowforge badge asset or snippet.',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'flowforge-badge',
      source: 'bundled',
      resourceBase: { kind: 'directory', path: resourcePath },
    }])
    const loaded = await ctx.skills.get('flowforge-badge')
    expect(loaded?.content).toContain('Preserve the badge\'s 121×20 dimensions')
    expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: resourcePath })

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  it('ships the official 726×120 PNG unchanged', async () => {
    const image = await readFile(new URL('../assets/flowforge-badge.png', import.meta.url))
    expect(image.readUInt32BE(16)).toBe(726)
    expect(image.readUInt32BE(20)).toBe(120)
    expect(createHash('sha256').update(image).digest('hex')).toBe(
      'f2c4f5ec9cbe847c0c763545c4d839efa8485bc74203733d0a0e8259f233c653',
    )
  })
})
