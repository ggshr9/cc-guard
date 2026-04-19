import { existsSync, mkdirSync, writeFileSync, watch, readFileSync, openSync, closeSync, unlinkSync, statSync } from 'fs'
import {
  STATE_DIR, STATE_FILE, CONFIG_FILE, ALERTS_LOG, PID_FILE,
  CLAUDE_TELEMETRY_DIR, CLAUDE_PROJECTS_DIR, CLAUDE_CONFIG,
  RESOLV_CONF, DC_ASN_FILE,
  MAX_EVENTS, RETENTION_MS, FLUSH_INTERVAL_MS,
} from './config.ts'
import { RingBuffer } from './ring-buffer.ts'
import { loadConfig } from './config-loader.ts'
import { evaluateRisk, buildAlert, severityForCount, severityForBool } from './rules.ts'
import { scanConcurrentSessions } from './sources/session-sink.ts'
import { diffAccountRelevant } from './sources/ccswitch-sink.ts'
import { parseTelemetryFile, countByCategory } from './sources/telemetry-sink.ts'
import { isCloudflareIp, parseDigOutput, detectLeak } from './sources/dns-sink.ts'
import { AlertRouter } from './alerts/router.ts'
import { StderrBackend } from './alerts/stderr.ts'
import { JsonLogBackend } from './alerts/json-log.ts'
import { OsNotifyBackend } from './alerts/os-notify.ts'
import { WebhookBackend } from './alerts/webhook.ts'
import { WechatCcBackend } from './alerts/wechat-cc.ts'
import { NetworkSink } from './sources/network-sink.ts'
import { lookupPublicIp, lookupIpInfo, classifyAsn, DEFAULT_ENDPOINTS, type IpInfo } from './sources/ip-sink.ts'
import { spawn } from 'child_process'
import type { Event, Severity } from './events.ts'

const HOUR_MS = 60 * 60 * 1000
const TEN_MIN_MS = 10 * 60 * 1000
const ONE_MIN_MS = 60 * 1000

/** Acquire an exclusive PID lock. Fails loudly if another instance holds it. */
function acquirePidLock(): void {
  try {
    const fd = openSync(PID_FILE, 'wx')  // O_EXCL — fails if file exists
    writeFileSync(fd, String(process.pid))
    closeSync(fd)
  } catch {
    // PID file exists — check if owner is alive
    let owner = 0
    try { owner = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10) || 0 } catch {}
    if (owner > 0) {
      try {
        process.kill(owner, 0)
        process.stderr.write(`[cc-guard] another instance is running (pid ${owner})\n`)
        process.exit(1)
      } catch { /* stale — fall through */ }
    }
    try { unlinkSync(PID_FILE) } catch {}
    const fd = openSync(PID_FILE, 'wx')
    writeFileSync(fd, String(process.pid))
    closeSync(fd)
  }
}

/** Load the bundled datacenter ASN set. Falls back to empty on failure. */
function loadDatacenterAsns(): Set<string> {
  try {
    const raw = readFileSync(DC_ASN_FILE, 'utf8')
    const parsed = JSON.parse(raw) as { asns?: string[] }
    return new Set(parsed.asns ?? [])
  } catch {
    return new Set()
  }
}

export async function runDaemon(): Promise<void> {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  acquirePidLock()

  let cfg = loadConfig(CONFIG_FILE)
  const datacenterAsns = loadDatacenterAsns()
  const buffer = new RingBuffer({ file: STATE_FILE, capacity: MAX_EVENTS, retentionMs: RETENTION_MS })
  buffer.load()

  const router = new AlertRouter([
    new StderrBackend(cfg.alerts.stderr),
    new JsonLogBackend(cfg.alerts.json_log, ALERTS_LOG),
    new OsNotifyBackend(cfg.alerts.os_notify),
    new WebhookBackend(cfg.alerts.webhook),
    new WechatCcBackend(cfg.alerts.wechat_cc),
  ])

  /** Emit an event, push to buffer, evaluate risk, dispatch alert if warranted.
   *  Any event with severity medium+ fires an alert directly (router handles
   *  dedup); rules.evaluateRisk computes the aggregate but we also alert on
   *  individual medium+ events so single-signal high risks don't wait for
   *  noise escalation to trigger. */
  const emit = (event: Event): void => {
    buffer.push(event)
    if (event.severity === 'medium' || event.severity === 'high') {
      const alert = buildAlert(event, buffer.query(event.signal, HOUR_MS))
      void router.dispatch(alert)
    }
    // Also evaluate aggregate risk — if 3+ mediums happening at once, router
    // sees a synthetic high-level alert distinct from individual signals.
    const risk = evaluateRisk(buffer.all(), cfg)
    if (risk.overall === 'high' && event.severity !== 'high') {
      const synthetic: Event = {
        timestamp: Date.now(),
        signal: event.signal,
        severity: 'high',
        payload: { aggregate: true, active: risk.active },
      }
      void router.dispatch(buildAlert(synthetic, buffer.all().slice(-10)))
    }
  }

  // ── Session sink ────────────────────────────────────────────────────────
  let sessionDebounce: NodeJS.Timeout | null = null
  if (existsSync(CLAUDE_PROJECTS_DIR)) {
    watch(CLAUDE_PROJECTS_DIR, { recursive: true }, () => {
      if (sessionDebounce) clearTimeout(sessionDebounce)
      sessionDebounce = setTimeout(() => {
        const scan = scanConcurrentSessions(CLAUDE_PROJECTS_DIR, 5 * 60 * 1000)
        const severity = severityForCount(scan.count, cfg.thresholds.concurrent_sessions)
        if (severity !== 'info') {
          emit({
            timestamp: Date.now(),
            signal: 'concurrent_session',
            severity,
            payload: { count: scan.count, projects: scan.projects },
          })
        }
      }, 500)
    })
  }

  // ── cc-switch sink ──────────────────────────────────────────────────────
  let lastCcSwitch: Record<string, unknown> = {}
  try { lastCcSwitch = JSON.parse(readFileSync(CLAUDE_CONFIG, 'utf8')) } catch {}
  let ccSwitchDebounce: NodeJS.Timeout | null = null
  if (existsSync(CLAUDE_CONFIG)) {
    watch(CLAUDE_CONFIG, () => {
      // Debounce — editors often fire change + rename for a single save
      if (ccSwitchDebounce) clearTimeout(ccSwitchDebounce)
      ccSwitchDebounce = setTimeout(() => {
        let next: Record<string, unknown> = {}
        try { next = JSON.parse(readFileSync(CLAUDE_CONFIG, 'utf8')) } catch { return }
        const d = diffAccountRelevant(lastCcSwitch as Parameters<typeof diffAccountRelevant>[0], next as Parameters<typeof diffAccountRelevant>[1])
        if (d) {
          // Count prior account_switch events to apply per-hour threshold
          const recent = buffer.query('account_switch', HOUR_MS)
          const count = recent.length + 1  // +1 for this event
          const severity = severityForCount(count, cfg.thresholds.account_switches_per_hour)
          emit({
            timestamp: Date.now(),
            signal: 'account_switch',
            severity: severity === 'info' ? 'low' : severity,  // record even if below threshold
            payload: { reason: d.reason, oldValue: d.oldValue, newValue: d.newValue, count_1h: count },
          })
        }
        lastCcSwitch = next
      }, 500)
    })
  }

  // ── Telemetry sink ──────────────────────────────────────────────────────
  // Track per-file byte offsets so we re-read the tail on each modification
  // instead of processing each file just once. Claude Code appends events to
  // the same file throughout a session.
  if (existsSync(CLAUDE_TELEMETRY_DIR)) {
    const fileOffsets = new Map<string, number>()
    const readTail = (filename: string): void => {
      const fullPath = `${CLAUDE_TELEMETRY_DIR}/${filename}`
      try {
        const size = statSync(fullPath).size
        const prevOffset = fileOffsets.get(filename) ?? 0
        if (size <= prevOffset) return  // file truncated / unchanged
        const fd = openSync(fullPath, 'r')
        const buf = Buffer.alloc(size - prevOffset)
        const { readSync } = require('fs') as typeof import('fs')
        readSync(fd, buf, 0, buf.length, prevOffset)
        closeSync(fd)
        fileOffsets.set(filename, size)

        const events = parseTelemetryFile(buf.toString('utf8'))
        const tally = countByCategory(events)

        const authFailed = tally.byHighEvent.tengu_api_auth_failed ?? 0
        if (authFailed > 0) {
          emit({ timestamp: Date.now(), signal: 'api_auth_failed', severity: 'high', payload: { count: authFailed } })
        }
        const rateLimited = tally.byHighEvent.tengu_api_rate_limited ?? 0
        if (rateLimited > 0) {
          emit({ timestamp: Date.now(), signal: 'api_rate_limited', severity: 'high', payload: { count: rateLimited } })
        }
        const stalls = (tally.byHighEvent.tengu_streaming_stall ?? 0)
                     + (tally.byHighEvent.tengu_streaming_stall_summary ?? 0)
        if (stalls > 0) {
          const recentStalls = buffer.query('streaming_stall', TEN_MIN_MS)
            .reduce((sum, e) => sum + (typeof e.payload.count === 'number' ? e.payload.count : 1), 0)
          const totalStalls = recentStalls + stalls
          const severity = severityForCount(totalStalls, cfg.thresholds.streaming_stalls_per_10min)
          if (severity !== 'info') {
            emit({ timestamp: Date.now(), signal: 'streaming_stall', severity, payload: { count: stalls, total_10min: totalStalls } })
          }
        }
        const apiQueries = tally.byHighEvent.tengu_api_query ?? 0
        if (apiQueries > 0) {
          const recent = buffer.query('api_query_rate', ONE_MIN_MS)
            .reduce((sum, e) => sum + (typeof e.payload.count === 'number' ? e.payload.count : 1), 0)
          const perMinute = recent + apiQueries
          const severity = severityForCount(perMinute, cfg.thresholds.api_query_per_minute)
          if (severity !== 'info') {
            emit({ timestamp: Date.now(), signal: 'api_query_rate', severity, payload: { count: apiQueries, per_minute: perMinute } })
          }
        }
      } catch { /* unreadable file — ignore */ }
    }
    watch(CLAUDE_TELEMETRY_DIR, (_kind, filename) => {
      if (!filename) return
      readTail(filename)
    })
  }

  // ── Network + IP sink ───────────────────────────────────────────────────
  const net = new NetworkSink()
  let lastIp: string | null = null
  let lastIpInfo: IpInfo | null = null
  net.on('change', async () => {
    const ip = await lookupPublicIp(DEFAULT_ENDPOINTS)
    if (!ip || ip === lastIp) return
    const info = await lookupIpInfo(ip)
    const classified = classifyAsn({ ...info, ip }, datacenterAsns)
    const payload = {
      old_ip: lastIp,
      new_ip: ip,
      old_asn: lastIpInfo?.asn ?? null,
      new_asn: classified.asn ?? null,
      old_country: lastIpInfo?.country ?? null,
      new_country: classified.country ?? null,
      org: classified.org ?? null,
      is_datacenter: classified.is_datacenter,
    }

    // Datacenter IP is an immediate high
    let severity: Severity = 'info'
    if (classified.is_datacenter) {
      severity = severityForBool(true, cfg.thresholds.ip_is_datacenter)
    }
    // Cross-ASN / cross-country events in last hour
    if (severity !== 'high') {
      const recent = buffer.query('ip_change', HOUR_MS)
      const crossAsn = recent.filter(e => e.payload.old_asn !== e.payload.new_asn).length
        + (lastIpInfo && lastIpInfo.asn !== classified.asn ? 1 : 0)
      const crossCountry = recent.filter(e => e.payload.old_country !== e.payload.new_country).length
        + (lastIpInfo && lastIpInfo.country !== classified.country ? 1 : 0)
      const sAsn = severityForCount(crossAsn, cfg.thresholds.ip_change_cross_asn_per_hour)
      const sCountry = severityForCount(crossCountry, cfg.thresholds.ip_change_cross_country_per_hour)
      severity = maxSeverity([severity, sAsn, sCountry])
    }

    lastIp = ip
    lastIpInfo = classified
    emit({
      timestamp: Date.now(),
      signal: 'ip_change',
      severity: severity === 'info' ? 'low' : severity,
      payload,
    })
  })
  net.start()

  // ── DNS sink ────────────────────────────────────────────────────────────
  let dnsDebounce: NodeJS.Timeout | null = null
  const checkDns = async (): Promise<void> => {
    // Run `dig api.anthropic.com +short` and check if resolver is Cloudflare
    try {
      const ips = await digShort('api.anthropic.com')
      const nonCloudflare = ips.filter(ip => !isCloudflareIp(ip))
      if (ips.length > 0 && nonCloudflare.length > 0) {
        const severity = severityForBool(true, cfg.thresholds.dns_api_anthropic_non_cloudflare)
        emit({
          timestamp: Date.now(),
          signal: 'dns_drift',
          severity: severity === 'info' ? 'low' : severity,
          payload: { resolved: ips, non_cloudflare: nonCloudflare },
        })
      }
      // Optional DNS leak check if VPN DNS configured
      if (cfg.network.vpn_expected_dns) {
        const vpnIps = await digShort('api.anthropic.com', cfg.network.vpn_expected_dns)
        const leakResult = detectLeak(vpnIps, ips)
        if (leakResult.leaked) {
          const severity = severityForBool(true, cfg.thresholds.dns_leak_detected)
          emit({
            timestamp: Date.now(),
            signal: 'dns_leak',
            severity: severity === 'info' ? 'low' : severity,
            payload: { reason: leakResult.reason, vpn_dns: cfg.network.vpn_expected_dns },
          })
        }
      }
    } catch { /* dig not available — silent */ }
  }
  if (existsSync(RESOLV_CONF)) {
    watch(RESOLV_CONF, () => {
      if (dnsDebounce) clearTimeout(dnsDebounce)
      dnsDebounce = setTimeout(() => {
        const recent = buffer.query('dns_drift', HOUR_MS)
        const severity = severityForCount(recent.length + 1, cfg.thresholds.dns_resolv_changes_per_hour)
        if (severity !== 'info') {
          emit({
            timestamp: Date.now(),
            signal: 'dns_drift',
            severity,
            payload: { reason: 'resolv.conf changed', count_1h: recent.length + 1 },
          })
        }
        void checkDns()
      }, 500)
    })
  }
  // One-shot sanity on startup
  void checkDns()

  // ── Config hot-reload ───────────────────────────────────────────────────
  if (existsSync(CONFIG_FILE)) {
    watch(CONFIG_FILE, () => {
      try {
        cfg = loadConfig(CONFIG_FILE)
        process.stderr.write('[cc-guard] config reloaded\n')
      } catch { /* keep prior cfg */ }
    })
  }

  // ── Periodic flush + heartbeat + 1h sanity tick ─────────────────────────
  const flushTimer = setInterval(() => { buffer.flush(); process.stderr.write('.') }, FLUSH_INTERVAL_MS)
  const sanityTimer = setInterval(() => { void checkDns() }, cfg.network.sanity_check_hours * HOUR_MS)

  // ── Graceful shutdown ───────────────────────────────────────────────────
  const shutdown = (): void => {
    clearInterval(flushTimer)
    clearInterval(sanityTimer)
    net.stop()
    buffer.flush()
    try { unlinkSync(PID_FILE) } catch {}
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  process.stderr.write(`[cc-guard] daemon started (pid=${process.pid})\n`)
}

// ── Helpers ─────────────────────────────────────────────────────────────

const SEVERITY_RANK_MAP: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 }
function maxSeverity(list: Severity[]): Severity {
  let max: Severity = 'info'
  for (const s of list) if (SEVERITY_RANK_MAP[s] > SEVERITY_RANK_MAP[max]) max = s
  return max
}

/** Run `dig +short <host> [@<server>]` and parse IPv4 results. Timeout 3s. */
async function digShort(host: string, server?: string): Promise<string[]> {
  return await new Promise<string[]>((resolve) => {
    const args = ['+short', '+time=3', host]
    if (server) args.unshift(`@${server}`)
    const proc = spawn('dig', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    proc.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString('utf8') })
    proc.on('error', () => resolve([]))
    proc.on('exit', () => resolve(parseDigOutput(out)))
  })
}
