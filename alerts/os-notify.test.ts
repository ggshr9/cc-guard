import { describe, it, expect, vi } from 'vitest'
import { OsNotifyBackend, buildNotifyCommand } from './os-notify'
import type { Alert } from '../events'

const alert: Alert = {
  timestamp: 0, level: 'high', signal: 'ip_change',
  title: 'IP', message: 'test', advice: 'A',
  evidence: [], fingerprint: 'x',
}

describe('buildNotifyCommand', () => {
  it('builds notify-send command for linux', () => {
    const cmd = buildNotifyCommand('linux', alert)
    expect(cmd[0]).toBe('notify-send')
    expect(cmd).toContain('--urgency=critical')
    expect(cmd).toContain('IP (HIGH)')
  })

  it('builds osascript command for darwin', () => {
    const cmd = buildNotifyCommand('darwin', alert)
    expect(cmd[0]).toBe('osascript')
    expect(cmd[1]).toBe('-e')
    expect(cmd[2]).toMatch(/display notification/)
  })

  it('builds powershell command for win32', () => {
    const cmd = buildNotifyCommand('win32', alert)
    expect(cmd[0]).toBe('powershell.exe')
    expect(cmd.join(' ')).toMatch(/Windows\.UI\.Notifications/)
  })

  it('returns empty on unknown platform', () => {
    expect(buildNotifyCommand('aix', alert)).toEqual([])
  })
})
