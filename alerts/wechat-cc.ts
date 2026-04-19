import { spawn as realSpawn } from 'child_process'
import type { Alert, Severity } from '../events'
import type { AlertBackend } from './types'

const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 }

export function buildArgs(alert: Alert, chatId: string): string[] {
  const text = `${alert.title} (${alert.level.toUpperCase()})\n${alert.message}\n→ ${alert.advice}`
  return ['reply', '--to', chatId, text]
}

export class WechatCcBackend implements AlertBackend {
  name = 'wechat-cc'
  private disabled = false

  constructor(
    private cfg: { enabled: boolean; chat_id: string; wechat_cc_path?: string; min_level: Severity },
    private spawnFn: typeof realSpawn = realSpawn,
  ) {}

  async send(alert: Alert): Promise<void> {
    if (!this.cfg.enabled || this.disabled) return
    if (SEVERITY_RANK[alert.level] < SEVERITY_RANK[this.cfg.min_level]) return
    if (!this.cfg.chat_id) {
      this.disableSelf('no chat_id configured')
      return
    }

    const cmd = this.cfg.wechat_cc_path ?? 'wechat-cc'
    const args = buildArgs(alert, this.cfg.chat_id)
    await new Promise<void>(resolve => {
      try {
        const proc = this.spawnFn(cmd, args, { stdio: 'ignore' })
        proc.on('error', err => {
          this.disableSelf(`spawn failed: ${err.message}`)
          resolve()
        })
        proc.on('exit', code => {
          if (code !== 0) process.stderr.write(`[cc-guard] wechat-cc exited ${code}\n`)
          resolve()
        })
      } catch (err) {
        this.disableSelf(`spawn threw: ${err}`)
        resolve()
      }
    })
  }

  private disableSelf(reason: string): void {
    this.disabled = true
    process.stderr.write(`[cc-guard] wechat-cc backend disabled: ${reason}\n`)
  }
}
