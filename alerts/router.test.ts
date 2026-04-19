import { describe, it, expect } from 'vitest'
import { AlertRouter } from './router'
import type { Alert } from '../events'
import type { AlertBackend } from './types'

const alert = (fingerprint: string, level: Alert['level'] = 'medium'): Alert => ({
  timestamp: Date.now(),
  level, signal: 'ip_change',
  title: 'IP change',
  message: '...',
  advice: '...',
  evidence: [],
  fingerprint,
})

describe('AlertRouter', () => {
  it('dispatches to all enabled backends', async () => {
    const calls: string[] = []
    const a: AlertBackend = { name: 'a', send: async () => { calls.push('a') } }
    const b: AlertBackend = { name: 'b', send: async () => { calls.push('b') } }
    const router = new AlertRouter([a, b])
    await router.dispatch(alert('fp1'))
    expect(calls.sort()).toEqual(['a', 'b'])
  })

  it('dedupes same fingerprint within 30min', async () => {
    let count = 0
    const backend: AlertBackend = { name: 'x', send: async () => { count++ } }
    const router = new AlertRouter([backend])
    await router.dispatch(alert('samefp'))
    await router.dispatch(alert('samefp'))
    expect(count).toBe(1)
  })

  it('allows different fingerprints through', async () => {
    let count = 0
    const backend: AlertBackend = { name: 'x', send: async () => { count++ } }
    const router = new AlertRouter([backend])
    await router.dispatch(alert('fp1'))
    await router.dispatch(alert('fp2'))
    expect(count).toBe(2)
  })

  it('continues dispatching to other backends if one fails', async () => {
    const calls: string[] = []
    const ok: AlertBackend = { name: 'ok', send: async () => { calls.push('ok') } }
    const bad: AlertBackend = { name: 'bad', send: async () => { throw new Error('boom') } }
    const router = new AlertRouter([bad, ok])
    await router.dispatch(alert('fp1'))
    expect(calls).toContain('ok')
  })

  it('expires dedup entry after 30 min', async () => {
    let count = 0
    const backend: AlertBackend = { name: 'x', send: async () => { count++ } }
    const router = new AlertRouter([backend])
    await router.dispatch(alert('fp1'))
    // simulate time passing
    router['lastSent'].set('fp1', Date.now() - 31 * 60 * 1000)
    await router.dispatch(alert('fp1'))
    expect(count).toBe(2)
  })
})
