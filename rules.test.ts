import { describe, it, expect } from 'vitest'
import { evaluateRisk, buildAlert, ADVICE } from './rules'
import { DEFAULT_CONFIG } from './config-loader'
import type { Event } from './events'

const mk = (signal: Event['signal'], ts: number, severity: Event['severity'] = 'medium'): Event => ({
  timestamp: ts, signal, severity, payload: {},
})

describe('evaluateRisk', () => {
  it('returns info when no events', () => {
    expect(evaluateRisk([], DEFAULT_CONFIG)).toEqual({ overall: 'info', active: [] })
  })

  it('returns max severity across active signals', () => {
    const now = Date.now()
    const events = [
      mk('ip_change', now, 'medium'),
      mk('dns_drift', now, 'high'),
    ]
    const result = evaluateRisk(events, DEFAULT_CONFIG)
    expect(result.overall).toBe('high')
    expect(result.active).toContain('dns_drift')
  })

  it('aggregates 3 medium signals to high (noise escalation)', () => {
    const now = Date.now()
    const events = [
      mk('ip_change', now, 'medium'),
      mk('concurrent_session', now, 'medium'),
      mk('account_switch', now, 'medium'),
    ]
    const result = evaluateRisk(events, DEFAULT_CONFIG)
    expect(result.overall).toBe('high')
  })

  it('ignores events outside the 5-minute active window', () => {
    const now = Date.now()
    const events = [
      mk('ip_change', now - 10 * 60 * 1000, 'high'),  // 10 min ago
    ]
    const result = evaluateRisk(events, DEFAULT_CONFIG)
    expect(result.overall).toBe('info')
  })
})

describe('ADVICE map', () => {
  it('has an entry for every SignalName', () => {
    const signals: Event['signal'][] = [
      'ip_change', 'concurrent_session', 'api_query_rate',
      'api_auth_failed', 'api_rate_limited', 'streaming_stall',
      'account_switch', 'dns_drift', 'dns_leak',
    ]
    for (const s of signals) {
      expect(ADVICE[s]).toBeTruthy()
      expect(ADVICE[s].length).toBeGreaterThan(10)
    }
  })
})

describe('buildAlert', () => {
  it('produces an Alert with fingerprint and advice', () => {
    const ev = mk('ip_change', Date.now(), 'high')
    const alert = buildAlert(ev, [ev])
    expect(alert.level).toBe('high')
    expect(alert.signal).toBe('ip_change')
    expect(alert.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(alert.advice).toBe(ADVICE.ip_change)
    expect(alert.evidence).toHaveLength(1)
  })

  it('different signal+level combinations produce different fingerprints', () => {
    const a = buildAlert(mk('ip_change', 1, 'medium'), [])
    const b = buildAlert(mk('ip_change', 2, 'high'), [])
    const c = buildAlert(mk('dns_drift', 3, 'medium'), [])
    expect(a.fingerprint).not.toBe(b.fingerprint)
    expect(a.fingerprint).not.toBe(c.fingerprint)
  })
})
