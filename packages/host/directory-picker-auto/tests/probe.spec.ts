import { describe, it, expect } from 'vitest'
import { delimiter, join } from 'node:path'
import { hasLinuxChooserBinary } from '../src/index.ts'

/** A deterministic predicate that emulates an executable chooser binary list. */
function makeExecutable(set: ReadonlySet<string>) {
  return (candidate: string): boolean => set.has(candidate)
}

describe('hasLinuxChooserBinary', () => {
  it('scans each PATH directory for zenity or kdialog', () => {
    const isExecutable = makeExecutable(new Set([join('/usr/bin', 'zenity')]))
    expect(hasLinuxChooserBinary('/usr/bin', isExecutable)).toBe(true)
    expect(hasLinuxChooserBinary('/opt/bin', isExecutable)).toBe(false)
  })

  it('honors the PATH delimiter by splitting on entries', () => {
    const isExecutable = makeExecutable(new Set([join('/a', 'kdialog')]))
    expect(hasLinuxChooserBinary(['/usr/bin', '/a'].join(delimiter), isExecutable)).toBe(true)
  })

  it('treats absent or empty PATH as scanning nothing', () => {
    const isExecutable = () => true
    expect(hasLinuxChooserBinary(undefined, isExecutable)).toBe(false)
    expect(hasLinuxChooserBinary('', isExecutable)).toBe(false)
  })

  it('ignores empty directories that the PATH delimiter yields', () => {
    const isExecutable = makeExecutable(new Set([join('/usr/bin', 'zenity')]))
    expect(hasLinuxChooserBinary([delimiter, '/usr/bin', delimiter].join(''), isExecutable)).toBe(true)
  })

  it('returns false when no directory holds a chooser binary', () => {
    expect(hasLinuxChooserBinary('/missing', () => false)).toBe(false)
  })
})