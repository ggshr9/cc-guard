import { appendFileSync } from 'fs'
import type { Alert, Severity } from '../events'
import type { AlertBackend } from './types'

const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 }

/** Mask IPv4 / IPv6 addresses found anywhere in the input string.
 *  - IPv4 is matched embedded (substring-safe via word boundaries).
 *  - IPv6 is only masked when the whole string is a valid address; partial
 *    matches inside prose are left alone to avoid mangling unrelated text.
 *  Returns the input unchanged when no match is found. */
export function anonymizeIp(s: string): string {
  // Substring-safe IPv4: replace every "a.b.c.d" with "a.b.c.0"
  let out = s.replace(/\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b/g, '$1.0')

  // Whole-string IPv6: only when the entire input looks like an address
  if (out.includes(':') && /^[0-9a-fA-F:]+$/.test(out)) {
    const parts = out.split(':').filter(p => p.length > 0)
    if (parts.length === 0) return '::'
    if (parts.length <= 3) return parts.join(':') + '::'
    return parts.slice(0, 3).join(':') + '::'
  }
  return out
}

/** Recursively walk a value, applying anonymizeIp to every string leaf. */
function visit(node: unknown): unknown {
  if (typeof node === 'string') return anonymizeIp(node)
  if (Array.isArray(node)) return node.map(visit)
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) out[k] = visit(v)
    return out
  }
  return node
}

/** Deep-clone an alert and anonymize every IP-shaped string in every field
 *  (message, advice, title, evidence.payload — everything). */
function anonymizeAlert(alert: Alert): Alert {
  const clone = JSON.parse(JSON.stringify(alert)) as Alert
  return visit(clone) as Alert
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
