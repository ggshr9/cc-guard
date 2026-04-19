import { appendFileSync } from 'fs'
import type { Alert, Severity } from '../events'
import type { AlertBackend } from './types'

const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 }

/** Mask an IPv4 or IPv6 address by zeroing the low bits. Returns the
 *  input unchanged when it doesn't look like an IP. */
export function anonymizeIp(s: string): string {
  // IPv4: zero the last octet
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s)) {
    return s.replace(/\.\d+$/, '.0')
  }
  // IPv6: keep first 3 groups, zero the rest
  if (s.includes(':') && /^[0-9a-fA-F:]+$/.test(s)) {
    const parts = s.split(':')
    if (parts.length >= 3) return parts.slice(0, 3).join(':') + '::'
  }
  return s
}

/** Recursively anonymize IP-shaped strings inside an arbitrary value. */
function anonymizeAlert(alert: Alert): Alert {
  const clone: Alert = JSON.parse(JSON.stringify(alert))
  const visit = (node: unknown): unknown => {
    if (typeof node === 'string') return anonymizeIp(node)
    if (Array.isArray(node)) return node.map(visit)
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node)) out[k] = visit(v)
      return out
    }
    return node
  }
  clone.message = visit(clone.message) as string
  const ev = clone.evidence as unknown as Record<string, unknown>[]
  for (const e of ev) {
    e.payload = visit(e.payload) as Record<string, unknown>
  }
  return clone
}

export class JsonLogBackend implements AlertBackend {
  name = 'json-log'
  constructor(
    private cfg: { enabled: boolean; min_level: Severity },
    private file: string,
    private anonymize: boolean = false,
  ) {}

  async send(alert: Alert): Promise<void> {
    if (!this.cfg.enabled) return
    if (SEVERITY_RANK[alert.level] < SEVERITY_RANK[this.cfg.min_level]) return
    const payload = this.anonymize ? anonymizeAlert(alert) : alert
    appendFileSync(this.file, JSON.stringify(payload) + '\n', { mode: 0o600 })
  }
}
