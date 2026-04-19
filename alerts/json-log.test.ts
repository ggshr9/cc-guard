import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { JsonLogBackend } from './json-log'
import type { Alert } from '../events'

const tmpDirs: string[] = []
let logFile: string

beforeEach(() => {
  const d = mkdtempSync(join(tmpdir(), 'cc-guard-jlog-'))
  tmpDirs.push(d)
  logFile = join(d, 'alerts.log')
})

afterAll(() => {
  for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
})

const alert = (): Alert => ({
  timestamp: 12345, level: 'medium', signal: 'ip_change',
  title: 'T', message: 'M', advice: 'A', evidence: [], fingerprint: 'FP',
})

describe('JsonLogBackend', () => {
  it('appends a JSON line per alert', async () => {
    const b = new JsonLogBackend({ enabled: true, min_level: 'low' }, logFile)
    await b.send(alert())
    await b.send({ ...alert(), fingerprint: 'FP2' })
    const lines = readFileSync(logFile, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).fingerprint).toBe('FP')
  })

  it('suppresses below min_level', async () => {
    const b = new JsonLogBackend({ enabled: true, min_level: 'high' }, logFile)
    await b.send(alert())  // medium, below high
    let contents = ''
    try { contents = readFileSync(logFile, 'utf8') } catch {}
    expect(contents).toBe('')
  })
})
