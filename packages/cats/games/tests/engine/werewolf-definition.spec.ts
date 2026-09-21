import { describe, it, expect } from 'vitest'
import { createWerewolfDefinition, WEREWOLF_PRESETS } from '../../src/engine/werewolf-definition.ts'
import { WEREWOLF_ROLES as ROLE_TABLE } from '../../src/engine/werewolf-roles.ts'

describe('createWerewolfDefinition', () => {
  it('builds a full definition for a supported player count', () => {
    const def = createWerewolfDefinition(6)
    expect(def.gameType).toBe('werewolf')
    expect(def.minPlayers).toBe(6)
    expect(def.maxPlayers).toBe(6)
    expect(def.roles).toHaveLength(4) // wolf/seer/witch/villager
    expect(def.phases.length).toBeGreaterThan(0)
    expect(def.actions.length).toBeGreaterThan(0)
    expect(def.winConditions).toHaveLength(2)
  })

  it('exposes standard werewolf roles with correct factions', () => {
    expect(ROLE_TABLE.wolf.faction).toBe('wolf')
    expect(ROLE_TABLE.seer.faction).toBe('village')
    expect(ROLE_TABLE.witch.nightActionPhase).toBe('night_witch')
    expect(ROLE_TABLE.hunter.nightActionPhase).toBeUndefined()
  })

  it('has presets for 6/7/8/9/10/12 player boards', () => {
    expect(Object.keys(WEREWOLF_PRESETS).map(Number).sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10, 12])
  })

  it('role distributions match the selected preset', () => {
    const def = createWerewolfDefinition(12)
    const counts = Object.fromEntries(def.roles.map((r) => [r.name, (WEREWOLF_PRESETS[12]!.roles[r.name] ?? 0)]))
    expect(counts.wolf).toBe(4)
    expect(def.roles.some((r) => r.name === 'guard')).toBe(true)
  })

  it('produces a 12-phase night→day sequence ending with day_hunter', () => {
    const def = createWerewolfDefinition(6)
    expect(def.phases[0]!.name).toBe('night_guard')
    expect(def.phases.at(-1)!.name).toBe('day_hunter')
    expect(def.phases.some((p) => p.name === 'night_resolve')).toBe(true)
    expect(def.phases.some((p) => p.name === 'day_vote')).toBe(true)
  })

  it('throws on an unsupported player count', () => {
    expect(() => createWerewolfDefinition(5)).toThrow(/No werewolf preset/)
    expect(() => createWerewolfDefinition(100)).toThrow(/No werewolf preset/)
  })

  it('every preset role resolves to a defined role entry', () => {
    for (const preset of Object.values(WEREWOLF_PRESETS)) {
      for (const roleName of Object.keys(preset.roles)) {
        expect(ROLE_TABLE[roleName], `unknown role ${roleName}`).toBeDefined()
      }
    }
  })
})