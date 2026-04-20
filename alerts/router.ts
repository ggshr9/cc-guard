import type { Alert } from '../events'
import type { AlertBackend } from './types'

const DEDUP_WINDOW_MS = 30 * 60 * 1000

export interface AlertRouterOptions {
  /** Fired after dedup filter passes, before backends run. Use this to tee
   *  alerts to out-of-band consumers (dashboard SSE etc.). Throws from the
   *  hook are swallowed so a broken listener can't break routing. */
  onDispatch?: (alert: Alert) => void
}

export class AlertRouter {
  private lastSent = new Map<string, number>()

  constructor(private backends: AlertBackend[], private options: AlertRouterOptions = {}) {}

  async dispatch(alert: Alert): Promise<void> {
    const last = this.lastSent.get(alert.fingerprint)
    if (last !== undefined && Date.now() - last < DEDUP_WINDOW_MS) {
      return
    }
    this.lastSent.set(alert.fingerprint, Date.now())

    if (this.options.onDispatch) {
      try { this.options.onDispatch(alert) }
      catch (err) {
        process.stderr.write(`[cc-guard] alert onDispatch hook threw: ${err}\n`)
      }
    }

    await Promise.allSettled(
      this.backends.map(b => b.send(alert).catch(err => {
        process.stderr.write(`[cc-guard] alert backend '${b.name}' failed: ${err}\n`)
      })),
    )
  }
}
