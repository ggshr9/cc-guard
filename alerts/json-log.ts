import { appendFileSync } from 'fs'
import type { Alert, Severity } from '../events'
import type { AlertBackend } from './types'

const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 }

export class JsonLogBackend implements AlertBackend {
  name = 'json-log'
  constructor(private cfg: { enabled: boolean; min_level: Severity }, private file: string) {}

  async send(alert: Alert): Promise<void> {
    if (!this.cfg.enabled) return
    if (SEVERITY_RANK[alert.level] < SEVERITY_RANK[this.cfg.min_level]) return
    appendFileSync(this.file, JSON.stringify(alert) + '\n', { mode: 0o600 })
  }
}
