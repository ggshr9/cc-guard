import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { JsonLogBackend, anonymizeIp } from './json-log'
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

  it('anonymizes IPv4 addresses in payload when anonymize=true', async () => {
    const b = new JsonLogBackend({ enabled: true, min_level: 'low' }, logFile, true)
    await b.send({
      ...alert(),
      evidence: [{ timestamp: 1, signal: 'ip_change', severity: 'medium', payload: { new_ip: '103.22.200.55' } }],
    })
    const line = readFileSync(logFile, 'utf8').trim()
    const parsed = JSON.parse(line)
    expect(parsed.evidence[0].payload.new_ip).toBe('103.22.200.0')
  })

  it('leaves IPs intact when anonymize=false (default)', async () => {
    const b = new JsonLogBackend({ enabled: true, min_level: 'low' }, logFile)
    await b.send({
      ...alert(),
      evidence: [{ timestamp: 1, signal: 'ip_change', severity: 'medium', payload: { new_ip: '103.22.200.55' } }],
    })
    const parsed = JSON.parse(readFileSync(logFile, 'utf8').trim())
    expect(parsed.evidence[0].payload.new_ip).toBe('103.22.200.55')
  })
})

describe('anonymizeIp', () => {
  it('zeroes the last IPv4 octet', () => {
    expect(anonymizeIp('1.2.3.4')).toBe('1.2.3.0')
    expect(anonymizeIp('203.0.113.55')).toBe('203.0.113.0')
  })

  it('keeps first 3 IPv6 groups and zeroes the rest', () => {
    expect(anonymizeIp('2400:cb00:1234:5678::5')).toBe('2400:cb00:1234::')
  })

  it('handles compressed IPv6 forms correctly', () => {
    expect(anonymizeIp('::1')).toBe('1::')              // all-zero prefix
    expect(anonymizeIp('2400:cb00::1')).toBe('2400:cb00:1::')  // mid-compression
    expect(anonymizeIp('fe80::abcd')).toBe('fe80:abcd::')      // short address
  })

})

describe('JsonLogBackend anonymization scope', () => {
  it('anonymizes IPs in title and advice too (not just message / evidence)', async () => {
    const b = new JsonLogBackend({ enabled: true, min_level: 'low' }, logFile, true)
    await b.send({
      ...alert(),
      title: 'IP alert for 1.2.3.4',
      advice: 'Block 5.6.7.8 next time',
      evidence: [{ timestamp: 1, signal: 'ip_change', severity: 'medium', payload: {} }],
    })
    const parsed = JSON.parse(readFileSync(logFile, 'utf8').trim())
    expect(parsed.title).toContain('1.2.3.0')
    expect(parsed.title).not.toContain('1.2.3.4')
    expect(parsed.advice).toContain('5.6.7.0')
    expect(parsed.advice).not.toContain('5.6.7.8')
  })

  it('returns non-IP strings unchanged', () => {
    expect(anonymizeIp('hello world')).toBe('hello world')
    expect(anonymizeIp('compass')).toBe('compass')
  })
})
