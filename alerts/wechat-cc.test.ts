import { describe, it, expect, vi } from 'vitest'
import { WechatCcBackend, buildArgs } from './wechat-cc'
import type { Alert } from '../events'

const alert: Alert = {
  timestamp: 0, level: 'high', signal: 'ip_change',
  title: 'IP instability', message: 'IP changed', advice: 'pause',
  evidence: [], fingerprint: 'x',
}

describe('buildArgs', () => {
  it('builds reply --to <chat_id> "<text>" args', () => {
    const args = buildArgs(alert, 'o9_abc@im.wechat')
    expect(args[0]).toBe('reply')
    expect(args[1]).toBe('--to')
    expect(args[2]).toBe('o9_abc@im.wechat')
    expect(args[3]).toMatch(/IP instability/)
    expect(args[3]).toMatch(/→/)
  })
})

describe('WechatCcBackend', () => {
  it('disables itself when chat_id missing', async () => {
    const spawn = vi.fn()
    const b = new WechatCcBackend({ enabled: true, chat_id: '', min_level: 'low' }, spawn)
    await b.send(alert)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('spawns wechat-cc with reply subcommand', async () => {
    const spawn = vi.fn().mockImplementation(() => ({
      on: (event: string, cb: any) => { if (event === 'exit') setTimeout(() => cb(0), 0) },
    }))
    const b = new WechatCcBackend({ enabled: true, chat_id: 'chat1', min_level: 'low' }, spawn as any)
    await b.send(alert)
    expect(spawn).toHaveBeenCalled()
    const [cmd, args] = spawn.mock.calls[0]!
    expect(cmd).toBe('wechat-cc')
    expect(args[0]).toBe('reply')
  })
})
