import type { Alert, Severity } from '../events'
import type { AlertBackend } from './types'

const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 }
const MAX_CONSECUTIVE = 5
const RETRIES = 3

type FetchFn = typeof fetch

export class WebhookBackend implements AlertBackend {
  name = 'webhook'
  private disabled = false
  private consecutiveFailures = 0

  constructor(
    private cfg: {
      enabled: boolean
      url: string
      headers?: Record<string, string>
      min_level: Severity
    },
    private fetchFn: FetchFn = fetch,
    private opts: { retryDelayMs?: number } = {},
  ) {}

  async send(alert: Alert): Promise<void> {
    if (!this.cfg.enabled || this.disabled || !this.cfg.url) return
    if (SEVERITY_RANK[alert.level] < SEVERITY_RANK[this.cfg.min_level]) return

    const success = await this.tryWithRetries(alert)
    if (success) {
      this.consecutiveFailures = 0
    } else {
      this.consecutiveFailures++
      if (this.consecutiveFailures >= MAX_CONSECUTIVE) {
        this.disabled = true
        process.stderr.write(`[cc-guard] webhook disabled after ${MAX_CONSECUTIVE} consecutive failures (url=${this.cfg.url})\n`)
      }
    }
  }

  private async tryWithRetries(alert: Alert): Promise<boolean> {
    for (let i = 0; i < RETRIES; i++) {
      if (await this.post(alert)) return true
      if (i < RETRIES - 1) {
        const backoff = (this.opts.retryDelayMs ?? 1000) * 2 ** i
        await new Promise(r => setTimeout(r, backoff))
      }
    }
    return false
  }

  private async post(alert: Alert): Promise<boolean> {
    try {
      const res = await this.fetchFn(this.cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.cfg.headers ?? {}) },
        body: JSON.stringify(alert),
        signal: AbortSignal.timeout(5000),
      })
      return res.ok
    } catch {
      return false
    }
  }
}
