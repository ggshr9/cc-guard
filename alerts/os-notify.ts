import { spawn } from 'child_process'
import { platform } from 'os'
import type { Alert, Severity } from '../events'
import type { AlertBackend } from './types'

const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 }

const URGENCY_MAP: Record<Severity, string> = { info: 'low', low: 'low', medium: 'normal', high: 'critical' }

export function buildNotifyCommand(plat: string, alert: Alert): string[] {
  const title = `${alert.title} (${alert.level.toUpperCase()})`
  const body = `${alert.message}\n→ ${alert.advice}`
  if (plat === 'linux') {
    return ['notify-send', `--urgency=${URGENCY_MAP[alert.level]}`, title, body]
  }
  if (plat === 'darwin') {
    const escaped = body.replace(/"/g, '\\"')
    const titleE = title.replace(/"/g, '\\"')
    return ['osascript', '-e', `display notification "${escaped}" with title "${titleE}"`]
  }
  if (plat === 'win32') {
    const script = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null; $template = '<toast><visual><binding template="ToastGeneric"><text>${title}</text><text>${body.replace(/\n/g, ' ')}</text></binding></visual></toast>'; $xml = [Windows.Data.Xml.Dom.XmlDocument]::new(); $xml.LoadXml($template); $toast = [Windows.UI.Notifications.ToastNotification]::new($xml); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('cc-guard').Show($toast)`
    return ['powershell.exe', '-NoProfile', '-Command', script]
  }
  return []
}

export class OsNotifyBackend implements AlertBackend {
  name = 'os-notify'
  private disabled = false

  constructor(private cfg: { enabled: boolean; min_level: Severity }) {}

  async send(alert: Alert): Promise<void> {
    if (!this.cfg.enabled || this.disabled) return
    if (SEVERITY_RANK[alert.level] < SEVERITY_RANK[this.cfg.min_level]) return

    const cmd = buildNotifyCommand(platform(), alert)
    if (cmd.length === 0) {
      this.disableSelf(`unsupported platform ${platform()}`)
      return
    }

    await new Promise<void>(resolve => {
      const proc = spawn(cmd[0]!, cmd.slice(1), { stdio: 'ignore' })
      proc.on('error', err => {
        this.disableSelf(`spawn failed: ${err.message}`)
        resolve()
      })
      proc.on('exit', () => resolve())
    })
  }

  private disableSelf(reason: string): void {
    this.disabled = true
    process.stderr.write(`[cc-guard] os-notify disabled: ${reason}\n`)
  }
}
