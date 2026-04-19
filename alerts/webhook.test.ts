import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WebhookBackend } from './webhook'
import type { Alert } from '../events'

const alert: Alert = {
  timestamp: 0, level: 'high', signal: 'ip_change',
  title: 'T', message: 'M', advice: 'A', evidence: [], fingerprint: 'x',
}

function mockFetchOk() {
  return vi.fn().mockResolvedValue(new Response('OK', { status: 200 }))
}

function mockFetchFail(status: number) {
  return vi.fn().mockResolvedValue(new Response('Err', { status }))
}

describe('WebhookBackend', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs JSON alert on success', async () => {
    const fetchFn = mockFetchOk()
    const b = new WebhookBackend({ enabled: true, url: 'https://x/hook', min_level: 'low' }, fetchFn)
    await b.send(alert)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const call = fetchFn.mock.calls[0]!
    expect(call[0]).toBe('https://x/hook')
    expect(call[1].method).toBe('POST')
  })

  it('retries up to 3 times on failure', async () => {
    const fetchFn = mockFetchFail(500)
    const b = new WebhookBackend({ enabled: true, url: 'https://x/hook', min_level: 'low' }, fetchFn, { retryDelayMs: 1 })
    await b.send(alert)
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('auto-disables after 5 consecutive failures', async () => {
    const fetchFn = mockFetchFail(500)
    const b = new WebhookBackend({ enabled: true, url: 'https://x/hook', min_level: 'low' }, fetchFn, { retryDelayMs: 1 })
    for (let i = 0; i < 5; i++) {
      await b.send({ ...alert, fingerprint: `fp-${i}` })
    }
    expect((b as any).disabled).toBe(true)
    await b.send({ ...alert, fingerprint: 'fp-post' })  // should be skipped
    expect(fetchFn).toHaveBeenCalledTimes(15)  // 5 × 3 retries, no additional after disable
  })

  it('resets failure count on success', async () => {
    let failCount = 0
    const fetchFn = vi.fn().mockImplementation(() => {
      failCount++
      return Promise.resolve(new Response('', { status: failCount <= 2 ? 500 : 200 }))
    })
    const b = new WebhookBackend({ enabled: true, url: 'https://x/hook', min_level: 'low' }, fetchFn, { retryDelayMs: 1 })
    await b.send(alert)
    expect((b as any).consecutiveFailures).toBe(0)
  })
})
