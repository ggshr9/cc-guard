import type { Alert } from '../events'
import type { AlertBackend } from './types'

const DEDUP_WINDOW_MS = 30 * 60 * 1000

export class AlertRouter {
  private lastSent = new Map<string, number>()

  constructor(private backends: AlertBackend[]) {}

  async dispatch(alert: Alert): Promise<void> {
    const last = this.lastSent.get(alert.fingerprint)
    if (last !== undefined && Date.now() - last < DEDUP_WINDOW_MS) {
      return
    }
    this.lastSent.set(alert.fingerprint, Date.now())

    await Promise.allSettled(
      this.backends.map(b => b.send(alert).catch(err => {
        process.stderr.write(`[cc-guard] alert backend '${b.name}' failed: ${err}\n`)
      })),
    )
  }
}
