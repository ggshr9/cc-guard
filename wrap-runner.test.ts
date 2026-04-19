import { describe, it, expect } from 'vitest'
import { exitCodeForSignal } from './wrap-runner'

describe('exitCodeForSignal', () => {
  it('returns 0 when no signal', () => {
    expect(exitCodeForSignal(null)).toBe(0)
  })

  it('returns 130 for SIGINT (128 + 2)', () => {
    expect(exitCodeForSignal('SIGINT')).toBe(130)
  })

  it('returns 143 for SIGTERM (128 + 15)', () => {
    expect(exitCodeForSignal('SIGTERM')).toBe(143)
  })

  it('returns 129 for SIGHUP (128 + 1)', () => {
    expect(exitCodeForSignal('SIGHUP')).toBe(129)
  })

  it('returns 137 for SIGKILL (128 + 9)', () => {
    expect(exitCodeForSignal('SIGKILL')).toBe(137)
  })

  it('falls back to 128 for unknown signal', () => {
    expect(exitCodeForSignal('SIGNOTREAL')).toBe(128)
  })
})
