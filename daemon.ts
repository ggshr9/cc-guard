import { existsSync, mkdirSync, writeFileSync, watch, readFileSync } from 'fs'
import { STATE_DIR, STATE_FILE, CONFIG_FILE, ALERTS_LOG, PID_FILE,
         CLAUDE_TELEMETRY_DIR, CLAUDE_PROJECTS_DIR, CLAUDE_CONFIG,
         MAX_EVENTS, RETENTION_MS, FLUSH_INTERVAL_MS } from './config.ts'
import { RingBuffer } from './ring-buffer.ts'
import { loadConfig, DEFAULT_CONFIG } from './config-loader.ts'
import { evaluateRisk, buildAlert } from './rules.ts'
import { scanConcurrentSessions } from './sources/session-sink.ts'
import { diffAccountRelevant } from './sources/ccswitch-sink.ts'
import { parseTelemetryFile, countByCategory } from './sources/telemetry-sink.ts'
import { AlertRouter } from './alerts/router.ts'
import { StderrBackend } from './alerts/stderr.ts'
import { JsonLogBackend } from './alerts/json-log.ts'
import { OsNotifyBackend } from './alerts/os-notify.ts'
import { WebhookBackend } from './alerts/webhook.ts'
import { WechatCcBackend } from './alerts/wechat-cc.ts'
import { NetworkSink } from './sources/network-sink.ts'
import { lookupPublicIp, DEFAULT_ENDPOINTS } from './sources/ip-sink.ts'
import type { Event } from './events.ts'

export async function runDaemon(): Promise<void> {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })

  // Singleton lock (best-effort advisory)
  if (existsSync(PID_FILE)) {
    const existing = readFileSync(PID_FILE, 'utf8').trim()
    try {
      process.kill(parseInt(existing, 10), 0)
      process.stderr.write(`[cc-guard] another instance is running (pid ${existing})\n`)
      process.exit(1)
    } catch {
      // stale pid file; continue
    }
  }
  writeFileSync(PID_FILE, String(process.pid))

  const cfg = loadConfig(CONFIG_FILE)
  const buffer = new RingBuffer({ file: STATE_FILE, capacity: MAX_EVENTS, retentionMs: RETENTION_MS })
  buffer.load()

  const router = new AlertRouter([
    new StderrBackend(cfg.alerts.stderr),
    new JsonLogBackend(cfg.alerts.json_log, ALERTS_LOG),
    new OsNotifyBackend(cfg.alerts.os_notify),
    new WebhookBackend(cfg.alerts.webhook),
    new WechatCcBackend(cfg.alerts.wechat_cc),
  ])

  const emit = (event: Event): Promise<void> => {
    buffer.push(event)
    const risk = evaluateRisk(buffer.all(), cfg)
    if (risk.overall === 'medium' || risk.overall === 'high') {
      const alert = buildAlert(event, buffer.query(event.signal, 60 * 60 * 1000))
      return router.dispatch(alert)
    }
    return Promise.resolve()
  }

  // Session sink — poll on fs.watch
  let sessionDebounce: NodeJS.Timeout | null = null
  if (existsSync(CLAUDE_PROJECTS_DIR)) {
    watch(CLAUDE_PROJECTS_DIR, { recursive: true }, () => {
      if (sessionDebounce) clearTimeout(sessionDebounce)
      sessionDebounce = setTimeout(() => {
        const scan = scanConcurrentSessions(CLAUDE_PROJECTS_DIR, 5 * 60 * 1000)
        if (scan.count >= 2) {
          const sev = scan.count >= 3 ? 'high' : 'medium'
          void emit({ timestamp: Date.now(), signal: 'concurrent_session', severity: sev, payload: { count: scan.count, projects: scan.projects } })
        }
      }, 500)
    })
  }

  // cc-switch sink — fs.watch ~/.claude.json
  let lastCcSwitch: Record<string, unknown> = {}
  try { lastCcSwitch = JSON.parse(readFileSync(CLAUDE_CONFIG, 'utf8')) } catch {}
  if (existsSync(CLAUDE_CONFIG)) {
    watch(CLAUDE_CONFIG, () => {
      let next: Record<string, unknown> = {}
      try { next = JSON.parse(readFileSync(CLAUDE_CONFIG, 'utf8')) } catch { return }
      const d = diffAccountRelevant(lastCcSwitch as any, next as any)
      if (d) {
        void emit({ timestamp: Date.now(), signal: 'account_switch', severity: 'medium', payload: d as unknown as Record<string, unknown> })
      }
      lastCcSwitch = next
    })
  }

  // Telemetry sink — fs.watch ~/.claude/telemetry/
  if (existsSync(CLAUDE_TELEMETRY_DIR)) {
    const seen = new Set<string>()
    watch(CLAUDE_TELEMETRY_DIR, (_kind, filename) => {
      if (!filename || seen.has(filename)) return
      seen.add(filename)
      try {
        const body = readFileSync(`${CLAUDE_TELEMETRY_DIR}/${filename}`, 'utf8')
        const events = parseTelemetryFile(body)
        const tally = countByCategory(events)
        const authFailed = tally.byHighEvent.tengu_api_auth_failed ?? 0
        const rateLimited = tally.byHighEvent.tengu_api_rate_limited ?? 0
        const stalls = tally.byHighEvent.tengu_streaming_stall ?? 0
        if (authFailed > 0) void emit({ timestamp: Date.now(), signal: 'api_auth_failed', severity: 'high', payload: { count: authFailed } })
        if (rateLimited > 0) void emit({ timestamp: Date.now(), signal: 'api_rate_limited', severity: 'high', payload: { count: rateLimited } })
        if (stalls > 0) void emit({ timestamp: Date.now(), signal: 'streaming_stall', severity: stalls >= 5 ? 'high' : 'medium', payload: { count: stalls } })
      } catch {}
    })
  }

  // Network + IP sink
  const net = new NetworkSink()
  let lastIp: string | null = null
  net.on('change', async () => {
    const ip = await lookupPublicIp(DEFAULT_ENDPOINTS)
    if (ip && ip !== lastIp) {
      lastIp = ip
      void emit({ timestamp: Date.now(), signal: 'ip_change', severity: 'medium', payload: { ip } })
    }
  })
  net.start()

  // Periodic flush + heartbeat
  const flushTimer = setInterval(() => { buffer.flush(); process.stderr.write('.') }, FLUSH_INTERVAL_MS)

  // Graceful shutdown
  const shutdown = (): void => {
    clearInterval(flushTimer)
    net.stop()
    buffer.flush()
    try { writeFileSync(PID_FILE, '') } catch {}
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  process.stderr.write(`[cc-guard] daemon started (pid=${process.pid})\n`)
}
