import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DashboardServer } from './dashboard-server'
import { RingBuffer } from './ring-buffer'
import { DEFAULT_CONFIG } from './config-loader'
import type { Alert, Event } from './events'

/**
 * These tests verify the HTTP/SSE contract that the dashboard client
 * depends on — response shapes, endpoint availability, SSE event types.
 * They boot a real Bun.serve listening on an ephemeral port and hit it
 * with fetch(), because the shape-and-behavior of `fetch + json()` is
 * the exact thing the client sees.
 *
 * Rather than mocking time/randomness, we seed a RingBuffer with a tiny
 * fixed event list and assert derived fields match.
 */

function pickPort(): number {
    // Bun.serve with port: 0 auto-assigns; read the resolved port via
    // server.port in the start path. For parallel test runs we still
    // want distinct ports so tests don't collide.
    return 30000 + Math.floor(Math.random() * 30000)
}

function makeEvent(partial: Partial<Event>): Event {
    return {
        timestamp: Date.now(),
        signal: 'ip_change',
        severity: 'info',
        payload: {},
        ...partial,
    } as Event
}

function makeAlert(partial: Partial<Alert>): Alert {
    return {
        timestamp: Date.now(),
        level: 'medium',
        signal: 'ip_change',
        title: 't',
        message: 'm',
        advice: 'a',
        evidence: [],
        fingerprint: 'abc123',
        ...partial,
    } as Alert
}

function makeStaticDir(tmp: string): string {
    const dir = join(tmp, 'dashboard')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>')
    writeFileSync(join(dir, 'styles.css'), 'body {}')
    writeFileSync(join(dir, 'app.js'), 'console.log(1)')
    return dir
}

describe('DashboardServer', () => {
    let tmp: string
    let server: DashboardServer
    let buffer: RingBuffer
    let port: number

    beforeEach(() => {
        tmp = mkdtempSync(join(tmpdir(), 'ccgd-'))
        buffer = new RingBuffer({
            file: join(tmp, 'events.json'),
            capacity: 1000,
            retentionMs: 24 * 60 * 60 * 1000,
        })
        port = pickPort()
        server = new DashboardServer({
            port,
            version: '0.2.0',
            buffer,
            staticDir: makeStaticDir(tmp),
            getConfig: () => DEFAULT_CONFIG,
            getEnabledBackends: () => ({
                stderr: { enabled: true, min_level: 'low' },
                os_notify: { enabled: true, min_level: 'medium' },
            }),
        })
        server.start()
    })

    afterEach(() => {
        server.stop()
        rmSync(tmp, { recursive: true, force: true })
    })

    it('serves static index at /', async () => {
        const r = await fetch(`http://127.0.0.1:${port}/`)
        expect(r.status).toBe(200)
        expect(r.headers.get('content-type')).toContain('text/html')
        expect(await r.text()).toContain('<title>x</title>')
    })

    it('returns 404 for unknown paths', async () => {
        const r = await fetch(`http://127.0.0.1:${port}/nope`)
        expect(r.status).toBe(404)
    })

    it('derives overview with zero alerts when buffer is empty', async () => {
        const r = await fetch(`http://127.0.0.1:${port}/api/overview`)
        const data = await r.json() as Record<string, unknown>
        expect(data.status).toBe('watching')
        expect(data.activeAlerts).toBe(0)
        expect(data.version).toBe('0.2.0')
        expect(Array.isArray(data.signals)).toBe(true)
        expect((data.signals as unknown[]).length).toBe(6)
    })

    it('elevates overview to degraded when a medium event sits in the buffer', async () => {
        buffer.push(makeEvent({ signal: 'ip_change', severity: 'medium', payload: { old_ip: '1.1.1.1', new_ip: '8.8.8.8' } }))
        const r = await fetch(`http://127.0.0.1:${port}/api/overview`)
        const data = await r.json() as Record<string, unknown>
        expect(data.status).toBe('degraded')
        const signals = data.signals as Array<{ key: string; status: string }>
        const ip = signals.find(s => s.key === 'ip')!
        expect(ip.status).toBe('warn')
    })

    it('elevates overview to alert when a high event sits in the buffer', async () => {
        buffer.push(makeEvent({ signal: 'dns_leak', severity: 'high', payload: { leak: 'dns leak seen' } }))
        const r = await fetch(`http://127.0.0.1:${port}/api/overview`)
        const data = await r.json() as Record<string, unknown>
        expect(data.status).toBe('alert')
    })

    it('exposes alerts pushed via pushAlert()', async () => {
        server.pushAlert(makeAlert({ title: 'test alert' }))
        const r = await fetch(`http://127.0.0.1:${port}/api/alerts`)
        const data = await r.json() as { alerts: Array<{ title: string; id: string; level: string }> }
        expect(data.alerts.length).toBe(1)
        expect(data.alerts[0]!.title).toBe('test alert')
        expect(data.alerts[0]!.level).toBe('medium')
    })

    it('caps held alerts at 100', async () => {
        for (let i = 0; i < 150; i++) {
            server.pushAlert(makeAlert({ title: `a${i}`, fingerprint: `fp${i}` }))
        }
        const r = await fetch(`http://127.0.0.1:${port}/api/alerts`)
        const data = await r.json() as { alerts: unknown[]; total: number }
        expect(data.alerts.length).toBe(100)
        expect(data.total).toBe(100)
    })

    it('returns events newest-first from the ring buffer', async () => {
        const now = Date.now()
        // Buffer prunes events older than retentionMs (24h default) so we
        // use near-now timestamps. Ordering is by insertion, reversed on
        // read — so push ip_change first, dns_drift second, expect dns
        // first in response.
        buffer.push(makeEvent({ timestamp: now - 1000, signal: 'ip_change' }))
        buffer.push(makeEvent({ timestamp: now - 500,  signal: 'dns_drift' }))
        const r = await fetch(`http://127.0.0.1:${port}/api/events`)
        const data = await r.json() as { events: Array<{ ts: string; type: string }> }
        expect(data.events[0]!.type).toBe('dns_drift')
        expect(data.events[1]!.type).toBe('ip_change')
    })

    it('exposes config + backend state', async () => {
        const r = await fetch(`http://127.0.0.1:${port}/api/config`)
        const data = await r.json() as { meta: { version: string; pid: number }; backends: Record<string, unknown> }
        expect(data.meta.version).toBe('0.2.0')
        expect(data.meta.pid).toBe(process.pid)
        expect(data.backends.stderr).toBeDefined()
        expect((data.backends.os_notify as { enabled: boolean }).enabled).toBe(true)
    })

    it('SSE stream delivers initial overview event', async () => {
        const r = await fetch(`http://127.0.0.1:${port}/api/stream`)
        expect(r.headers.get('content-type')).toContain('text/event-stream')
        const reader = r.body!.getReader()
        const dec = new TextDecoder()
        let buf = ''
        // Read just enough to see the overview event, then cancel.
        for (let i = 0; i < 3 && !buf.includes('event: overview'); i++) {
            const { value, done } = await reader.read()
            if (done) break
            if (value) buf += dec.decode(value)
        }
        await reader.cancel()
        expect(buf).toContain('event: overview')
        expect(buf).toContain('"version":"0.2.0"')
    })
})
