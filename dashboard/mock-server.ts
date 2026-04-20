#!/usr/bin/env bun
/**
 * cc-guard dashboard mock server.
 *
 * Run: `bun mock-server.ts` from the dashboard/ dir.
 * Serves the static dashboard at http://localhost:3458/ with four REST
 * endpoints and one SSE stream that emits fake live events every few seconds
 * so you can see the UI react without running the real daemon.
 *
 * When integrating with the real cc-guard daemon, replace the handlers
 * with calls to ring-buffer / config-loader / rules — keep the response
 * shapes identical. Also keep the SSE event names (`overview`, `alert`,
 * `event`) so the client code doesn't change.
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const DIR = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 3458)
const START_TS = Date.now()

// ─── mock data generators ─────────────────────────────────────

const SIGNAL_DEFS = [
    { key: 'ip',         name: 'IP stability',        glyph: '⇄' },
    { key: 'session',    name: 'Concurrent sessions', glyph: '◎' },
    { key: 'telemetry',  name: 'Telemetry rate',      glyph: '↑' },
    { key: 'stall',      name: 'Streaming stall',     glyph: '∞' },
    { key: 'ccswitch',   name: 'cc-switch activity',  glyph: '⇌' },
    { key: 'dns',        name: 'DNS stability',       glyph: '@' },
]

const EVENT_SOURCES = ['ip', 'session', 'telemetry', 'stall', 'ccswitch', 'dns']

function uptime(): string {
    const secs = Math.floor((Date.now() - START_TS) / 1000) + 610_000  // fake 7d 3h
    const days = Math.floor(secs / 86400)
    const hours = Math.floor((secs % 86400) / 3600)
    return days > 0 ? `${days}d ${hours}h` : `${hours}h`
}

function makeOverview() {
    return {
        status: 'watching',
        statusDetail: 'IP stability degraded on wlan0',
        activeAlerts: alertsStore.filter(a => a.level === 'high' || a.level === 'medium').length,
        uptime: uptime(),
        uptimeSec: Math.floor((Date.now() - START_TS) / 1000) + 610_000,
        version: '0.2.0',
        signals: [
            { key: 'ip',        glyph: '⇄', name: 'IP stability',        value: '3 changes', subValue: '30 min',  status: 'warn', since: '14:32' },
            { key: 'session',   glyph: '◎', name: 'Concurrent sessions', value: '1',         subValue: 'active',  status: 'ok' },
            { key: 'telemetry', glyph: '↑', name: 'Telemetry rate',      value: '12 / min',  subValue: 'normal',  status: 'ok' },
            { key: 'stall',     glyph: '∞', name: 'Streaming stall',     value: '0',         subValue: 'in 24h',  status: 'ok' },
            { key: 'ccswitch',  glyph: '⇌', name: 'cc-switch activity',  value: '2h ago',    subValue: null,      status: 'ok' },
            { key: 'dns',       glyph: '@', name: 'DNS stability',       value: 'clean',     subValue: '0 leaks', status: 'ok' },
        ],
        recentAlerts: alertsStore.slice(0, 3),
    }
}

let alertIdSeq = 1
const alertsStore: Alert[] = seedAlerts()

type Severity = 'info' | 'low' | 'medium' | 'high'

interface Alert {
    id: string
    level: Severity
    signal: string
    title: string
    advice: string
    ts: string
}

function seedAlerts(): Alert[] {
    const now = Date.now()
    return [
        {
            id: `a${alertIdSeq++}`,
            level: 'high',
            signal: 'ip_stability',
            title: '3 IP changes in 12 minutes on wlan0',
            advice: 'Consider closing VPN clients or parallel routing tools. If you\'re commuting or tethering, this is expected and will settle.',
            ts: new Date(now - 28 * 60_000).toISOString(),
        },
        {
            id: `a${alertIdSeq++}`,
            level: 'medium',
            signal: 'dns_stability',
            title: 'DNS resolver drifted from 10.84.2.1 → 8.8.8.8',
            advice: 'Check whether a VPN client took over the resolver. Your system resolver changed mid-session.',
            ts: new Date(now - 2 * 3600_000 - 15 * 60_000).toISOString(),
        },
        {
            id: `a${alertIdSeq++}`,
            level: 'low',
            signal: 'cc_switch_activity',
            title: 'cc-switch fired twice in 5 minutes',
            advice: 'If you\'re testing account rotation this is fine. Otherwise investigate whether your shell is double-invoking cc-switch.',
            ts: new Date(now - 4 * 3600_000).toISOString(),
        },
        {
            id: `a${alertIdSeq++}`,
            level: 'info',
            signal: 'telemetry_rate',
            title: 'Daily telemetry baseline recomputed: 14 events/min',
            advice: 'Rolling 7-day baseline refreshed. Next alert thresholds: medium @ 28/min, high @ 56/min.',
            ts: new Date(now - 18 * 3600_000).toISOString(),
        },
    ]
}

let eventIdSeq = 1
const eventsStore: Event[] = seedEvents()

interface Event {
    id: string
    ts: string
    source: string
    type: string
    summary: string
    raw: Record<string, unknown>
}

function seedEvents(): Event[] {
    const now = Date.now()
    const types: Array<[string, string, (i: number) => string, () => Record<string, unknown>]> = [
        ['ip',        'ip_change',          (i) => `wlan0  10.84.${1 + i}.${42 + i} → 10.84.${1 + i}.${43 + i}`, () => ({ interface: 'wlan0', previous: '10.84.1.42', current: '10.84.1.43', family: 'ipv4' })],
        ['telemetry', 'event_observed',     (i) => `tengu.prompt_submitted · ${10 + i} events/min`,              () => ({ event: 'tengu.prompt_submitted', rate: 12, window_sec: 60 })],
        ['session',   'session_opened',     (_) => 'claude pid=3024150 cwd=~/Documents/compass',                 () => ({ pid: 3024150, cwd: '/home/u/Documents/compass' })],
        ['dns',       'resolver_drift',     (_) => '10.84.2.1 → 8.8.8.8 (systemd-resolved reload)',              () => ({ previous: '10.84.2.1', current: '8.8.8.8', interface: 'wlan0' })],
        ['ccswitch',  'activity_detected',  (i) => `switched account: work → personal (${i + 1} in last hour)`,  () => ({ from: 'work', to: 'personal', hourly_count: 2 })],
        ['stall',     'stream_healthy',     (_) => 'no stalls in the last 5 minutes',                             () => ({ window_sec: 300, stalls: 0 })],
    ]
    const out: Event[] = []
    for (let i = 0; i < 40; i++) {
        const [source, type, summary, raw] = types[i % types.length]!
        out.push({
            id: `e${eventIdSeq++}`,
            ts: new Date(now - i * 4 * 60_000 - Math.random() * 60_000).toISOString(),
            source,
            type,
            summary: summary(i),
            raw: raw(),
        })
    }
    return out
}

function makeConfig() {
    return {
        meta: {
            version: '0.2.0',
            port: PORT,
            pid: process.pid,
            state_dir: `${process.env.HOME}/.claude/channels/cc-guard/`,
        },
        backends: {
            stderr:    { enabled: true,  min_level: 'medium', extra: null },
            os_notify: { enabled: true,  min_level: 'medium', extra: null },
            json_log:  { enabled: true,  min_level: 'low',    extra: '~/.claude/channels/cc-guard/alerts.jsonl' },
            webhook:   { enabled: false, min_level: 'high',   extra: null },
            wechat_cc: { enabled: false, min_level: 'high',   extra: null },
        },
        config: {
            signals: {
                ip_stability:        { enabled: true, change_threshold: 3, window_minutes: 30 },
                concurrent_sessions: { enabled: true, threshold: 2 },
                telemetry_rate:      { enabled: true, medium_rate: 28, high_rate: 56 },
                streaming_stall:     { enabled: true, timeout_seconds: 120 },
                cc_switch_activity:  { enabled: true, medium_hourly: 3, high_hourly: 6 },
                dns_stability:       { enabled: true, leak_detection: true, drift_detection: true },
            },
            retention: { events_hours: 24, alerts_days: 7 },
            privacy:   { scrub_ip: true, scrub_mac: true, scrub_hostname: true },
        },
    }
}

// ─── SSE ──────────────────────────────────────────────────────

const sseClients: Set<ReadableStreamDefaultController<Uint8Array>> = new Set()
const enc = new TextEncoder()

function sseBroadcast(event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    const chunk = enc.encode(payload)
    for (const c of sseClients) {
        try { c.enqueue(chunk) } catch { sseClients.delete(c) }
    }
}

// Demo: emit a fresh event every 6s, a fake alert every 45s.
setInterval(() => {
    const sample = eventsStore[Math.floor(Math.random() * eventsStore.length)]
    if (!sample) return
    const fresh: Event = {
        id: `e${eventIdSeq++}`,
        ts: new Date().toISOString(),
        source: sample.source,
        type: sample.type,
        summary: sample.summary,
        raw: sample.raw,
    }
    eventsStore.unshift(fresh)
    if (eventsStore.length > 200) eventsStore.pop()
    sseBroadcast('event', fresh)
}, 6000)

setInterval(() => {
    const samples: Alert[] = [
        { id: `a${alertIdSeq++}`, level: 'medium',  signal: 'telemetry_rate', title: 'Telemetry rate spiked to 32/min briefly',
          advice: 'Back under threshold now. If this keeps happening, something is bursting events; check Claude Code logs.',
          ts: new Date().toISOString() },
        { id: `a${alertIdSeq++}`, level: 'info',    signal: 'cc_switch_activity', title: 'cc-switch accessed (work)',
          advice: 'Account switch observed. No action needed — info-level events are for your timeline only.',
          ts: new Date().toISOString() },
    ]
    const fresh = samples[Math.floor(Math.random() * samples.length)]!
    alertsStore.unshift(fresh)
    if (alertsStore.length > 100) alertsStore.pop()
    sseBroadcast('alert', fresh)
    sseBroadcast('overview', makeOverview())
}, 45000)

// ─── server ───────────────────────────────────────────────────

function staticResponse(path: string, contentType: string): Response {
    try {
        const body = readFileSync(join(DIR, path))
        return new Response(body, { headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' } })
    } catch {
        return new Response('Not found', { status: 404 })
    }
}

function json(data: unknown): Response {
    return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    })
}

function sseResponse(): Response {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            sseClients.add(controller)
            controller.enqueue(enc.encode(`: hello\n\n`))
            // Seed client with current overview immediately.
            controller.enqueue(enc.encode(`event: overview\ndata: ${JSON.stringify(makeOverview())}\n\n`))
        },
        cancel() {
            // Stream closed; GC handled by broadcast's try/catch
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

const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url)
        const p = url.pathname

        // API routes
        if (p === '/api/overview') return json(makeOverview())
        if (p === '/api/alerts')   return json({ alerts: alertsStore.slice(0, Number(url.searchParams.get('limit') ?? 100)), total: alertsStore.length })
        if (p === '/api/events')   return json({ events: eventsStore.slice(0, Number(url.searchParams.get('limit') ?? 200)), total: eventsStore.length })
        if (p === '/api/config')   return json(makeConfig())
        if (p === '/api/stream')   return sseResponse()

        // Static assets
        if (p === '/' || p === '/index.html') return staticResponse('index.html', 'text/html; charset=utf-8')
        if (p === '/styles.css')              return staticResponse('styles.css', 'text/css; charset=utf-8')
        if (p === '/app.js')                  return staticResponse('app.js',     'text/javascript; charset=utf-8')

        return new Response('Not found', { status: 404 })
    },
})

console.log(`[cc-guard dashboard mock] http://localhost:${server.port}/`)
console.log(`  endpoints: /api/overview /api/alerts /api/events /api/config /api/stream`)
console.log(`  SSE emits a fake event every 6s and an alert every 45s`)
