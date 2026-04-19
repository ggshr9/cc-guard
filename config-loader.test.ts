import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadConfig, DEFAULT_CONFIG, type CcGuardConfig } from './config-loader'

const tmpDirs: string[] = []
let tmpDir: string
let configFile: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'cc-guard-cfg-'))
  tmpDirs.push(tmpDir)
  configFile = join(tmpDir, 'config.json')
})

afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }) } catch {}
  }
})

describe('loadConfig', () => {
  it('returns defaults when file missing', () => {
    const cfg = loadConfig(configFile)
    expect(cfg).toEqual(DEFAULT_CONFIG)
  })

  it('merges user config with defaults', () => {
    writeFileSync(configFile, JSON.stringify({
      alerts: { stderr: { enabled: false, min_level: 'high' } },
    }))
    const cfg = loadConfig(configFile)
    expect(cfg.alerts.stderr.enabled).toBe(false)
    expect(cfg.alerts.stderr.min_level).toBe('high')
    expect(cfg.alerts.os_notify.enabled).toBe(DEFAULT_CONFIG.alerts.os_notify.enabled)
    expect(cfg.thresholds).toEqual(DEFAULT_CONFIG.thresholds)
  })

  it('falls back to defaults on parse error', () => {
    writeFileSync(configFile, 'this is not json {')
    const cfg = loadConfig(configFile)
    expect(cfg).toEqual(DEFAULT_CONFIG)
  })

  it('falls back to defaults for invalid threshold values', () => {
    writeFileSync(configFile, JSON.stringify({
      thresholds: { concurrent_sessions: 'not-an-object' },
    }))
    const cfg = loadConfig(configFile)
    expect(cfg.thresholds.concurrent_sessions).toEqual(DEFAULT_CONFIG.thresholds.concurrent_sessions)
  })

  it('preserves valid per-alert min_level values', () => {
    writeFileSync(configFile, JSON.stringify({
      alerts: { webhook: { enabled: true, url: 'https://example.com', min_level: 'high' } },
    }))
    const cfg = loadConfig(configFile)
    expect(cfg.alerts.webhook.enabled).toBe(true)
    expect(cfg.alerts.webhook.url).toBe('https://example.com')
    expect(cfg.alerts.webhook.min_level).toBe('high')
  })

  it('rejects invalid wrap.auto_confirm_below', () => {
    writeFileSync(configFile, JSON.stringify({
      wrap: { auto_confirm_below: 'nonsense' },
    }))
    const cfg = loadConfig(configFile)
    expect(cfg.wrap.auto_confirm_below).toBe(DEFAULT_CONFIG.wrap.auto_confirm_below)
  })

  it('rejects wrap.timeout_seconds that is 0, negative, NaN, or Infinity', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 'abc']) {
      writeFileSync(configFile, JSON.stringify({ wrap: { timeout_seconds: bad } }))
      const cfg = loadConfig(configFile)
      expect(cfg.wrap.timeout_seconds).toBe(DEFAULT_CONFIG.wrap.timeout_seconds)
    }
  })

  it('preserves valid wrap.timeout_seconds', () => {
    writeFileSync(configFile, JSON.stringify({ wrap: { timeout_seconds: 30 } }))
    const cfg = loadConfig(configFile)
    expect(cfg.wrap.timeout_seconds).toBe(30)
  })

  it('rejects non-boolean privacy values', () => {
    writeFileSync(configFile, JSON.stringify({
      privacy: { anonymize_ip_in_logs: 'yes', send_analytics: 1, unknownKey: true },
    }))
    const cfg = loadConfig(configFile)
    expect(cfg.privacy.anonymize_ip_in_logs).toBe(DEFAULT_CONFIG.privacy.anonymize_ip_in_logs)
    expect(cfg.privacy.send_analytics).toBe(DEFAULT_CONFIG.privacy.send_analytics)
    // unknownKey should NOT appear in final cfg
    expect(Object.keys(cfg.privacy).sort()).toEqual(['anonymize_ip_in_logs', 'send_analytics'])
  })

  it('accepts valid boolean privacy values', () => {
    writeFileSync(configFile, JSON.stringify({
      privacy: { anonymize_ip_in_logs: true, send_analytics: false },
    }))
    const cfg = loadConfig(configFile)
    expect(cfg.privacy.anonymize_ip_in_logs).toBe(true)
    expect(cfg.privacy.send_analytics).toBe(false)
  })
})
