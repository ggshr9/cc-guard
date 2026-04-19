import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RingBuffer } from './ring-buffer'
import type { Event } from './events'

const tmpDirs: string[] = []
let tmpDir: string
let stateFile: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'cc-guard-rb-'))
  tmpDirs.push(tmpDir)
  stateFile = join(tmpDir, 'state.json')
})

afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }) } catch {}
  }
})

const event = (signal: Event['signal'], ts: number, severity: Event['severity'] = 'medium'): Event => ({
  timestamp: ts, signal, severity, payload: {},
})

describe('RingBuffer', () => {
  it('pushes and retains events', () => {
    const rb = new RingBuffer({ file: stateFile, capacity: 100, retentionMs: 3600_000 })
    rb.push(event('ip_change', Date.now()))
    expect(rb.all().length).toBe(1)
  })

  it('drops oldest when capacity exceeded', () => {
    const now = Date.now()
    const rb = new RingBuffer({ file: stateFile, capacity: 3, retentionMs: 3600_000 })
    rb.push(event('ip_change', now))
    rb.push(event('ip_change', now + 1))
    rb.push(event('ip_change', now + 2))
    rb.push(event('ip_change', now + 3))
    const ts = rb.all().map(e => e.timestamp).sort()
    expect(ts).toEqual([now + 1, now + 2, now + 3])
  })

  it('drops events older than retention window on push', () => {
    const now = Date.now()
    const rb = new RingBuffer({ file: stateFile, capacity: 100, retentionMs: 1000 })
    rb.push(event('ip_change', now - 5000))  // stale, should be dropped
    rb.push(event('ip_change', now))
    expect(rb.all().length).toBe(1)
  })

  it('queries by signal and time window', () => {
    const now = Date.now()
    const rb = new RingBuffer({ file: stateFile, capacity: 100, retentionMs: 3600_000 })
    rb.push(event('ip_change', now - 2000))
    rb.push(event('ip_change', now - 500))
    rb.push(event('dns_drift', now))
    expect(rb.query('ip_change', 1000).length).toBe(1)  // only last 1s → 1 event
    expect(rb.query('ip_change', 3000).length).toBe(2)
    expect(rb.query('dns_drift', 3000).length).toBe(1)
  })

  it('persists to disk and round-trips', () => {
    const ts = Date.now()
    const rb1 = new RingBuffer({ file: stateFile, capacity: 100, retentionMs: 3600_000 })
    rb1.push(event('ip_change', ts))
    rb1.flush()
    expect(existsSync(stateFile)).toBe(true)

    const rb2 = new RingBuffer({ file: stateFile, capacity: 100, retentionMs: 3600_000 })
    rb2.load()
    expect(rb2.all().length).toBe(1)
    expect(rb2.all()[0]!.timestamp).toBe(ts)
  })

  it('tolerates corrupted state file', () => {
    writeFileSync(stateFile, 'not valid json {')
    const rb = new RingBuffer({ file: stateFile, capacity: 100, retentionMs: 3600_000 })
    rb.load()  // should not throw
    expect(rb.all()).toEqual([])
  })

  it('atomic write leaves no .tmp file behind', () => {
    const rb = new RingBuffer({ file: stateFile, capacity: 100, retentionMs: 3600_000 })
    rb.push(event('ip_change', Date.now()))
    rb.flush()
    expect(existsSync(stateFile + '.tmp')).toBe(false)
  })
})
