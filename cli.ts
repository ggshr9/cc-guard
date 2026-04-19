#!/usr/bin/env bun
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  STATE_FILE, CONFIG_FILE, STATE_DIR, PID_FILE, ALERTS_LOG,
  CLAUDE_STATSIG_DIR,
} from './config.ts'
import { runDaemon } from './daemon.ts'
import { loadConfig } from './config-loader.ts'
import { evaluateRisk } from './rules.ts'
import { runWrap } from './wrap-runner.ts'
import { installSystemdUnit } from './install-systemd.ts'
import type { Event, Severity } from './events.ts'

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'help'

  switch (cmd) {
    case 'run': return runDaemon()
    case 'status': return renderStatus(process.argv.includes('--watch'), process.argv.includes('--raw'))
    case 'check': return runCheck()
    case 'doctor': return runDoctor()
    case 'wrap': {
      const code = await runWrap(process.argv.slice(3))
      process.exit(code)
    }
    case 'install-systemd-unit': {
      const force = process.argv.includes('--force')
      process.exit(installSystemdUnit({ force }))
    }
    case 'help':
    case '--help':
    case '-h': return showHelp()
    default:
      console.error(`unknown command: ${cmd}`)
      showHelp()
      process.exit(1)
  }
}

interface DaemonInfo {
  alive: boolean
  pid: number
  uptime: string
}

function daemonInfo(): DaemonInfo {
  if (!existsSync(PID_FILE)) return { alive: false, pid: 0, uptime: '—' }
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10)
    if (!Number.isFinite(pid) || pid <= 0) return { alive: false, pid: 0, uptime: '—' }
    process.kill(pid, 0)
    // Compute uptime from pidfile mtime (good enough; actual /proc lookup is Linux-only)
    const { mtimeMs } = require('fs').statSync(PID_FILE) as { mtimeMs: number }
    return { alive: true, pid, uptime: humanDuration(Date.now() - mtimeMs) }
  } catch {
    return { alive: false, pid: 0, uptime: '—' }
  }
}

function humanDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

/** Find the most recently-modified *.jsonl under ~/.claude/projects/<encoded-cwd>/ */
function currentClaudeSessionId(): string | null {
  try {
    const home = process.env.HOME ?? ''
    const encoded = process.cwd().replace(/\//g, '-')
    const dir = join(home, '.claude', 'projects', encoded)
    if (!existsSync(dir)) return null
    const { readdirSync, statSync } = require('fs') as typeof import('fs')
    const files = readdirSync(dir)
      .filter((f: string) => f.endsWith('.jsonl'))
      .map((f: string) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
      .sort((a: { m: number }, b: { m: number }) => b.m - a.m)
    const first = files[0] as { f: string } | undefined
    return first ? first.f.replace(/\.jsonl$/, '') : null
  } catch { return null }
}

function readStableId(): string | null {
  if (!existsSync(CLAUDE_STATSIG_DIR)) return null
  try {
    const { readdirSync } = require('fs') as typeof import('fs')
    const stableFile = readdirSync(CLAUDE_STATSIG_DIR).find((f: string) => f.startsWith('statsig.stable_id.'))
    if (!stableFile) return null
    return JSON.parse(readFileSync(join(CLAUDE_STATSIG_DIR, stableFile), 'utf8'))
  } catch { return null }
}

function loadEvents(): Event[] {
  if (!existsSync(STATE_FILE)) return []
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function countByWindow(events: Event[], windowMs: number): Map<string, number> {
  const cutoff = Date.now() - windowMs
  const m = new Map<string, number>()
  for (const e of events) {
    if (e.timestamp < cutoff) continue
    m.set(e.signal, (m.get(e.signal) ?? 0) + 1)
  }
  return m
}

function riskEmoji(level: Severity): string {
  return level === 'high' ? '🔴' : level === 'medium' ? '🟡' : level === 'low' ? '🟢' : 'ℹ️'
}

function readRecentAlerts(n: number): string[] {
  if (!existsSync(ALERTS_LOG)) return []
  try {
    const lines = readFileSync(ALERTS_LOG, 'utf8').trim().split('\n').filter(Boolean)
    const tail = lines.slice(-n).reverse()
    return tail.map(line => {
      try {
        const a = JSON.parse(line)
        const t = new Date(a.timestamp).toLocaleTimeString()
        return `  [${t}] ${riskEmoji(a.level)} ${a.signal} — ${String(a.message).slice(0, 64)}`
      } catch { return `  (unparseable line)` }
    })
  } catch { return [] }
}

async function renderStatus(watch: boolean, raw: boolean): Promise<void> {
  const render = (): void => {
    if (raw) {
      console.log(JSON.stringify({ events: loadEvents(), daemon: daemonInfo() }, null, 2))
      return
    }
    const cfg = loadConfig(CONFIG_FILE)
    const events = loadEvents()
    const risk = evaluateRisk(events, cfg)
    const dinfo = daemonInfo()
    const stable = readStableId()
    const sess = currentClaudeSessionId()
    const count5 = countByWindow(events, 5 * 60_000)
    const count1h = countByWindow(events, 60 * 60_000)

    const signals: Array<[string, number, number]> = []
    const allSignals = new Set<string>([...count1h.keys(), 'ip_change', 'concurrent_session', 'streaming_stall', 'api_query_rate', 'api_auth_failed', 'api_rate_limited', 'account_switch', 'dns_drift', 'dns_leak'])
    for (const s of allSignals) {
      const c5 = count5.get(s) ?? 0
      const c1h = count1h.get(s) ?? 0
      if (c5 === 0 && c1h === 0) continue
      signals.push([s, c5, c1h])
    }

    if (watch) console.log('\x1b[2J\x1b[H')  // clear screen + home

    const lines: string[] = [
      'cc-guard status',
      '═══════════════════════════════════════════════',
      `Risk level:   ${riskEmoji(risk.overall)} ${risk.overall.toUpperCase()}  (${risk.active.length} active signal${risk.active.length === 1 ? '' : 's'})`,
      `Device ID:    ${stable ?? '(not available)'}`,
      `Session:      ${sess ?? '(no active Claude session in this cwd)'}`,
      `Daemon:       ${dinfo.alive ? `✓ running (pid ${dinfo.pid}, up ${dinfo.uptime})` : '✗ not running'}`,
    ]
    if (signals.length === 0) {
      lines.push('', 'No signals observed yet.')
    } else {
      lines.push('', 'Signals (events seen):         5min   1h')
      for (const [name, c5, c1h] of signals) {
        lines.push(`  ${name.padEnd(28)}  ${String(c5).padStart(4)}  ${String(c1h).padStart(4)}`)
      }
    }
    const alerts = readRecentAlerts(3)
    if (alerts.length > 0) {
      lines.push('', 'Recent alerts:')
      lines.push(...alerts)
    }
    lines.push('')
    lines.push(`Config: ${CONFIG_FILE}`)
    lines.push(`State:  ${STATE_FILE}`)
    console.log(lines.join('\n'))
  }

  render()
  if (!watch) return
  const interval = setInterval(render, 2000)
  process.on('SIGINT', () => { clearInterval(interval); process.exit(0) })
  // keep alive
  await new Promise<void>(() => { /* until SIGINT */ })
}

function runCheck(): void {
  void renderStatus(false, false)
  const cfg = loadConfig(CONFIG_FILE)
  console.log('\nEnabled alert backends:')
  for (const [name, c] of Object.entries(cfg.alerts)) {
    const on = (c as { enabled: boolean }).enabled ? '✓' : '✗'
    console.log(`  ${on} ${name} (min_level=${(c as { min_level: string }).min_level})`)
  }
}

function runDoctor(): void {
  const checks: Array<[string, boolean, string]> = [
    ['State dir exists', existsSync(STATE_DIR), STATE_DIR],
    ['Config file exists', existsSync(CONFIG_FILE), CONFIG_FILE],
    ['Claude home accessible', existsSync(`${process.env.HOME}/.claude`), `${process.env.HOME}/.claude`],
    ['Claude telemetry dir', existsSync(`${process.env.HOME}/.claude/telemetry`), 'for telemetry-sink'],
    ['Claude projects dir', existsSync(`${process.env.HOME}/.claude/projects`), 'for session-sink'],
  ]
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${name}  ${detail}`)
  }
}

function showHelp(): void {
  console.log(`
cc-guard — Claude Code session health monitor

Commands:
  run                Start the background daemon (foreground process)
  status             Show current state dashboard
  status --watch     Live-refresh dashboard every 2 seconds
  status --raw       Print raw JSON
  check              One-shot scan + config summary
  doctor             Diagnose dependencies and permissions
  wrap <cmd> [args]  Exec <cmd> with pre-flight risk banner
                     (blocks only if daemon risk >= wrap.auto_confirm_below)
  install-systemd-unit
                     Generate ~/.config/systemd/user/cc-guard.service
                     (Linux only; pass --force to overwrite)
  help               Show this help

Config: ${CONFIG_FILE}
State:  ${STATE_FILE}

cc-guard only observes. It does not modify Claude Code or network config.
`.trim())
}

void main()
