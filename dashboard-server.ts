/**
 * cc-guard dashboard HTTP + SSE server.
 *
 * Serves the static dashboard bundle (dashboard/index.html + styles.css +
 * app.js) and four JSON endpoints over Bun.serve, plus an SSE stream that
 * pushes three event types to the client:
 *
 *   - `overview` — rebuilt snapshot when alert counts / signal states change
 *   - `alert`    — one per dispatched alert (after the router's dedup filter)
 *   - `event`    — one per emitted event from any sink
 *
 * The REST endpoints and SSE event shapes are identical to what
 * dashboard/mock-server.ts emits — the client doesn't know it's talking
 * to the real daemon vs the mock.
 *
 * Data source wiring:
 *   - recent events come from the RingBuffer passed in
 *   - recent alerts live in a small in-memory bounded store owned here
 *     (the router only keeps dedup fingerprints; it doesn't retain alerts)
 *   - signal state per source is derived by replaying the buffer over the
 *     last hour
 *   - config comes from the config-loader getter
 *
 * Zero external deps. Bun.serve + ReadableStream + string JSON.
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { Alert, Event, Severity, SignalName } from './events'
import type { CcGuardConfig } from './config-loader'
import type { RingBuffer } from './ring-buffer'

const MAX_ALERTS_HELD = 100

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_STATIC_DIR = join(__dirname, 'dashboard')

export interface DashboardServerOptions {
    port: number
    host?: string
    /** Directory containing index.html / styles.css / app.js. Defaults to
     *  `<cc-guard-root>/dashboard/`, which is where the bundled assets live
     *  in a standard git checkout. Override for testing. */
    staticDir?: string
    /** Version string shown in the UI. Pulled from package.json by the
     *  daemon at bootstrap. */
    version: string
    /** Live config getter — the loaded config is rebuilt on hot-reload, so
     *  resolve it lazily instead of capturing the initial reference. */
    getConfig: () => CcGuardConfig
    /** Ring buffer — we query it for recent events & signal state derivation. */
    buffer: RingBuffer
    /** Returns which backend keys are currently enabled for the Settings tab. */
    getEnabledBackends: () => Record<string, { enabled: boolean; min_level: Severity; extra?: string | null }>
}

interface OverviewResponse {
    status: 'watching' | 'degraded' | 'alert'
    statusDetail: string
    activeAlerts: number
    uptime: string
    uptimeSec: number
    version: string
    signals: SignalResponse[]
    recentAlerts: AlertResponse[]
}

interface SignalResponse {
    key: string
    glyph?: string
    name: string
    value: string
    subValue: string | null
    status: 'ok' | 'warn' | 'crit' | 'info'
    since: string | null
}

interface AlertResponse {
    id: string
    level: Severity
    signal: string
    title: string
    advice: string
    ts: string
}

interface EventResponse {
    id: string
    ts: string
    source: string
    type: string
    summary: string
    raw: Record<string, unknown>
}

/**
 * Maps signal names to user-facing labels + UI grouping keys. Keep keys
 * aligned with dashboard/styles.css (.status-dot.ok/warn/crit) and with
 * what app.js renders; if you add a signal, add it here too.
 */
const SIGNAL_DEFS: Array<{
    sources: SignalName[]
    key: string
    name: string
    glyph: string
}> = [
    { sources: ['ip_change'],           key: 'ip',        name: 'IP stability',        glyph: '⇄' },
    { sources: ['concurrent_session'],  key: 'session',   name: 'Concurrent sessions', glyph: '◎' },
    { sources: ['api_query_rate', 'api_auth_failed', 'api_rate_limited'], key: 'telemetry', name: 'Telemetry rate', glyph: '↑' },
    { sources: ['streaming_stall'],     key: 'stall',     name: 'Streaming stall',     glyph: '∞' },
    { sources: ['account_switch'],      key: 'ccswitch',  name: 'cc-switch activity',  glyph: '⇌' },
    { sources: ['dns_drift', 'dns_leak'], key: 'dns',     name: 'DNS stability',       glyph: '@' },
]

/** Bun's HTTP server surface. We type this narrowly rather than pull in
 *  the full Bun type pack because cc-guard's tsconfig targets `node` types
 *  only; this keeps tsc happy while remaining accurate for what we use. */
interface BunServer {
    port: number
    stop(closeActiveConnections?: boolean): void
}
declare const Bun: {
    serve(opts: { port: number; hostname?: string; fetch: (req: Request) => Response | Promise<Response> }): BunServer
}

export class DashboardServer {
    private server: BunServer | undefined = undefined
    private sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>()
    private enc = new TextEncoder()
    private alerts: AlertResponse[] = []
    private startTs = Date.now()
    private staticDir: string

    constructor(private opts: DashboardServerOptions) {
        this.staticDir = opts.staticDir ?? DEFAULT_STATIC_DIR
    }

    start(): void {
        if (this.server) return
        this.server = Bun.serve({
            port: this.opts.port,
            hostname: this.opts.host ?? '127.0.0.1',
            fetch: (req: Request) => this.handle(req),
        })
    }

    stop(): void {
        for (const c of this.sseClients) {
            try { c.close() } catch {}
        }
        this.sseClients.clear()
        this.server?.stop(true)
        this.server = undefined
    }

    get port(): number | undefined {
        return this.server?.port
    }

    /** Called from daemon whenever AlertRouter dispatches an alert (post-dedup). */
    pushAlert(alert: Alert): void {
        const resp = this.alertToResponse(alert)
        this.alerts.unshift(resp)
        if (this.alerts.length > MAX_ALERTS_HELD) this.alerts.pop()
        this.sseBroadcast('alert', resp)
        // Alert count changed → re-emit overview so the hero number updates.
        this.sseBroadcast('overview', this.buildOverview())
    }

    /** Called from daemon on every emit() — pushes to SSE only. */
    pushEvent(event: Event): void {
        this.sseBroadcast('event', this.eventToResponse(event))
    }

    // ─── handlers ────────────────────────────────────────────

    private async handle(req: Request): Promise<Response> {
        const url = new URL(req.url)
        const p = url.pathname

        if (p === '/api/overview') return this.json(this.buildOverview())
        if (p === '/api/alerts')   return this.json({ alerts: this.alerts.slice(0, Number(url.searchParams.get('limit') ?? 100)), total: this.alerts.length })
        if (p === '/api/events') {
            const limit = Number(url.searchParams.get('limit') ?? 200)
            const events = this.opts.buffer.all().slice(-limit).reverse().map(e => this.eventToResponse(e))
            return this.json({ events, total: events.length })
        }
        if (p === '/api/config')   return this.json(this.buildConfigResponse())
        if (p === '/api/stream')   return this.sseResponse()

        if (p === '/' || p === '/index.html') return this.static('index.html', 'text/html; charset=utf-8')
        if (p === '/styles.css')              return this.static('styles.css', 'text/css; charset=utf-8')
        if (p === '/app.js')                  return this.static('app.js',     'text/javascript; charset=utf-8')

        return new Response('Not found', { status: 404 })
    }

    private static(file: string, ctype: string): Response {
        const path = join(this.staticDir, file)
        if (!existsSync(path)) {
            return new Response(`Missing dashboard asset: ${file}. Install the dashboard bundle alongside the daemon.`, { status: 500 })
        }
        try {
            return new Response(readFileSync(path), {
                headers: { 'Content-Type': ctype, 'Cache-Control': 'no-cache' },
            })
        } catch (err) {
            return new Response(`Failed to read ${file}: ${err instanceof Error ? err.message : String(err)}`, { status: 500 })
        }
    }

    private json(data: unknown): Response {
        return new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        })
    }

    private sseResponse(): Response {
        const enc = this.enc
        const clients = this.sseClients
        const overview = this.buildOverview()
        const stream = new ReadableStream<Uint8Array>({
            start: (controller) => {
                clients.add(controller)
                try {
                    controller.enqueue(enc.encode(`: hello\n\n`))
                    controller.enqueue(enc.encode(`event: overview\ndata: ${JSON.stringify(overview)}\n\n`))
                } catch {
                    clients.delete(controller)
                }
            },
            cancel: () => {
                // garbage-collected lazily in broadcast via try/catch
            },
        })
        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            },
        })
    }

    private sseBroadcast(event: string, data: unknown): void {
        const chunk = this.enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        for (const c of this.sseClients) {
            try { c.enqueue(chunk) } catch { this.sseClients.delete(c) }
        }
    }

    // ─── builders ────────────────────────────────────────────

    private buildOverview(): OverviewResponse {
        const signals = this.buildSignals()
        const worst = worstOf(signals.map(s => s.status))
        const activeAlerts = this.alerts.filter(a => a.level === 'high' || a.level === 'medium').length

        const detail = signals.find(s => s.status === 'crit' || s.status === 'warn')
        const statusDetail = detail
            ? `${detail.name} is ${detail.status === 'crit' ? 'in alert' : 'degraded'}`
            : 'All signals within thresholds'

        return {
            status: worst === 'ok' ? 'watching' : worst === 'warn' ? 'degraded' : 'alert',
            statusDetail,
            activeAlerts,
            uptime: formatUptime(Date.now() - this.startTs),
            uptimeSec: Math.floor((Date.now() - this.startTs) / 1000),
            version: this.opts.version,
            signals,
            recentAlerts: this.alerts.slice(0, 3),
        }
    }

    private buildSignals(): SignalResponse[] {
        const HOUR_MS = 60 * 60 * 1000
        const cutoff = Date.now() - HOUR_MS
        const recent = this.opts.buffer.all().filter(e => e.timestamp >= cutoff)

        return SIGNAL_DEFS.map(def => {
            const matches = recent.filter(e => def.sources.includes(e.signal))
            const worst = worstSeverity(matches.map(e => e.severity))
            const status: SignalResponse['status'] =
                worst === 'high' ? 'crit' :
                worst === 'medium' ? 'warn' :
                worst === 'low' ? 'info' : 'ok'

            const latest = matches[matches.length - 1]
            const firstOffender = matches.find(e => e.severity === 'high' || e.severity === 'medium')

            return {
                key: def.key,
                glyph: def.glyph,
                name: def.name,
                value: matches.length === 0 ? 'clean' : `${matches.length} event${matches.length === 1 ? '' : 's'}`,
                subValue: matches.length === 0 ? 'last hour' : `last ${formatRelative(Date.now() - (latest?.timestamp ?? Date.now()))}`,
                status,
                since: firstOffender ? new Date(firstOffender.timestamp).toLocaleTimeString('en-GB') : null,
            }
        })
    }

    private alertToResponse(a: Alert): AlertResponse {
        return {
            id: `a${a.timestamp}-${a.fingerprint.slice(0, 6)}`,
            level: a.level,
            signal: a.signal,
            title: a.title,
            advice: a.advice,
            ts: new Date(a.timestamp).toISOString(),
        }
    }

    private eventToResponse(e: Event): EventResponse {
        return {
            id: `e${e.timestamp}-${e.signal}`,
            ts: new Date(e.timestamp).toISOString(),
            source: signalToSource(e.signal),
            type: e.signal,
            summary: summarizeEvent(e),
            raw: e.payload,
        }
    }

    private buildConfigResponse() {
        const cfg = this.opts.getConfig()
        return {
            meta: {
                version: this.opts.version,
                port: this.port ?? this.opts.port,
                pid: process.pid,
                state_dir: `${process.env.HOME}/.claude/channels/cc-guard/`,
                started_at: new Date(this.startTs).toISOString(),
            },
            backends: this.opts.getEnabledBackends(),
            config: cfg,
        }
    }
}

// ─── utils ───────────────────────────────────────────────────

const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 }

function worstSeverity(arr: Severity[]): Severity | null {
    let worst: Severity | null = null
    for (const s of arr) {
        if (worst === null || SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s
    }
    return worst
}

function worstOf(statuses: string[]): 'ok' | 'warn' | 'crit' {
    if (statuses.includes('crit')) return 'crit'
    if (statuses.includes('warn')) return 'warn'
    return 'ok'
}

function formatUptime(ms: number): string {
    const s = Math.floor(ms / 1000)
    const days = Math.floor(s / 86400)
    const hrs  = Math.floor((s % 86400) / 3600)
    const min  = Math.floor((s % 3600) / 60)
    if (days > 0) return `${days}d ${hrs}h`
    if (hrs > 0)  return `${hrs}h ${min}m`
    return `${min}m`
}

function formatRelative(ms: number): string {
    const s = Math.floor(ms / 1000)
    if (s < 60)   return `${s}s ago`
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
}

function signalToSource(signal: SignalName): string {
    for (const def of SIGNAL_DEFS) {
        if (def.sources.includes(signal)) return def.key
    }
    return signal
}

function summarizeEvent(e: Event): string {
    const p = e.payload
    switch (e.signal) {
        case 'ip_change': {
            const from = p.old_ip ?? p.previous ?? '?'
            const to   = p.new_ip ?? p.current ?? '?'
            return `${from} → ${to}`
        }
        case 'concurrent_session':
            return `${p.count ?? '?'} active`
        case 'api_query_rate':
            return `${p.rate ?? p.count ?? '?'} events/min`
        case 'api_auth_failed':
            return String(p.reason ?? 'auth failed')
        case 'streaming_stall':
            return `stall duration ${p.duration_ms ?? '?'}ms`
        case 'account_switch':
            return `${p.from ?? '?'} → ${p.to ?? '?'}`
        case 'dns_drift':
            return String(p.reason ?? 'resolver drift')
        case 'dns_leak':
            return String(p.leak ?? 'leak detected')
        default:
            return JSON.stringify(p).slice(0, 80)
    }
}
