import { describe, it, expect, vi } from 'vitest'
import { StderrBackend } from './stderr'
import type { Alert } from '../events'

const alert = (): Alert => ({
  timestamp: Date.now(), level: 'high', signal: 'ip_change',
  title: 'IP instability', message: 'foo', advice: 'pause',
  evidence: [], fingerprint: 'x',
})

describe('StderrBackend', () => {
  it('writes formatted line to process.stderr at or above min_level', async () => {
    const writes: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s: any) => {
      writes.push(String(s))
      return true
    })
    const b = new StderrBackend({ enabled: true, min_level: 'low' })
    await b.send(alert())
    expect(writes.some(s => s.includes('IP instability'))).toBe(true)
    spy.mockRestore()
  })

  it('suppresses alerts below min_level', async () => {
    const writes: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s: any) => {
      writes.push(String(s))
      return true
    })
    const b = new StderrBackend({ enabled: true, min_level: 'high' })
    await b.send({ ...alert(), level: 'low' })
    expect(writes.filter(s => s.includes('IP')).length).toBe(0)
    spy.mockRestore()
  })
})
