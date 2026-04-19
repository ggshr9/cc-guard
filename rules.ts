import { createHash } from 'crypto'
import type { CcGuardConfig } from './config-loader'
import type { Alert, Event, Severity, SignalName } from './events'

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0, low: 1, medium: 2, high: 3,
}

const ACTIVE_WINDOW_MS = 5 * 60 * 1000  // 5-minute active window

export const ADVICE: Record<SignalName, string> = {
  ip_change:           'Consider pausing 10 min; verify VPN/proxy stability.',
  concurrent_session:  'Close inactive Claude sessions.',
  api_query_rate:      'Reduce request frequency or take a short break.',
  api_auth_failed:     '🚨 Auth failed — check account status and proxy config.',
  api_rate_limited:    '🚨 Rate limited — stop and wait at least 10 minutes.',
  streaming_stall:     'Network instability detected — check connection.',
  account_switch:      'Frequent account switching may raise risk flags.',
  dns_drift:           'DNS resolution changed unexpectedly — verify setup.',
  dns_leak:            'DNS leak detected — VPN may not be routing DNS.',
}

const TITLE: Record<SignalName, string> = {
  ip_change:           'IP instability',
  concurrent_session:  'Multiple sessions active',
  api_query_rate:      'High API query rate',
  api_auth_failed:     'Authentication failed',
  api_rate_limited:    'Rate limited by Anthropic',
  streaming_stall:     'Streaming stalls',
  account_switch:      'Account switches',
  dns_drift:           'DNS drift',
  dns_leak:            'DNS leak',
}

export interface RiskResult {
  overall: Severity
  active: SignalName[]
}

export function evaluateRisk(events: Event[], _cfg: CcGuardConfig): RiskResult {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS
  const active = events.filter(e => e.timestamp >= cutoff)

  if (active.length === 0) return { overall: 'info', active: [] }

  // Max severity across active
  let max: Severity = 'info'
  for (const e of active) {
    if (SEVERITY_RANK[e.severity] > SEVERITY_RANK[max]) max = e.severity
  }

  // Noise escalation: >= 3 distinct signals at medium+ → high
  const mediumPlusSignals = new Set(
    active.filter(e => SEVERITY_RANK[e.severity] >= SEVERITY_RANK.medium).map(e => e.signal)
  )
  if (mediumPlusSignals.size >= 3 && SEVERITY_RANK[max] < SEVERITY_RANK.high) {
    max = 'high'
  }

  return { overall: max, active: [...new Set(active.map(e => e.signal))] }
}

export function buildAlert(trigger: Event, evidence: Event[]): Alert {
  const fingerprint = createHash('sha256')
    .update(`${trigger.signal}:${trigger.severity}`)
    .digest('hex')
  const titleBase = TITLE[trigger.signal]
  return {
    timestamp: trigger.timestamp,
    level: trigger.severity,
    signal: trigger.signal,
    title: `${titleBase} (${trigger.severity.toUpperCase()})`,
    message: describeEvent(trigger),
    advice: ADVICE[trigger.signal],
    evidence,
    fingerprint,
  }
}

function describeEvent(e: Event): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(e.payload)) {
    parts.push(`${k}: ${JSON.stringify(v)}`)
  }
  return parts.length > 0 ? parts.join(', ') : `signal=${e.signal}`
}
