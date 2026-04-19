import type { Alert, Severity } from '../events'
import type { AlertBackend } from './types'

const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 }

const EMOJI: Record<Severity, string> = { info: 'ℹ️', low: '🟢', medium: '🟡', high: '🔴' }

export class StderrBackend implements AlertBackend {
  name = 'stderr'
  constructor(private cfg: { enabled: boolean; min_level: Severity }) {}

  async send(alert: Alert): Promise<void> {
    if (!this.cfg.enabled) return
    if (SEVERITY_RANK[alert.level] < SEVERITY_RANK[this.cfg.min_level]) return
    const ts = new Date(alert.timestamp).toLocaleTimeString()
    const line =
      `[cc-guard ${ts}] ${EMOJI[alert.level]} ${alert.level.toUpperCase()} ${alert.signal} — ${alert.title}\n` +
      `  ${alert.message}\n` +
      `  → ${alert.advice}\n`
    process.stderr.write(line)
  }
}
