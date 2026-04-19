#!/usr/bin/env bun
import { existsSync, readFileSync } from 'fs'
import { STATE_FILE, CONFIG_FILE, STATE_DIR } from './config.ts'
import { runDaemon } from './daemon.ts'
import { loadConfig } from './config-loader.ts'
import { runWrap } from './wrap-runner.ts'
import { installSystemdUnit } from './install-systemd.ts'

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'help'

  switch (cmd) {
    case 'run': return runDaemon()
    case 'status': return showStatus()
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

function showStatus(): void {
  if (!existsSync(STATE_FILE)) {
    console.log('cc-guard: daemon has not run yet. Start with: cc-guard run')
    return
  }
  let events: any[] = []
  try { events = JSON.parse(readFileSync(STATE_FILE, 'utf8')) ?? [] } catch {}
  const recent = events.filter(e => Date.now() - e.timestamp < 5 * 60 * 1000)
  console.log('cc-guard status')
  console.log('───────────────')
  console.log(`State dir:       ${STATE_DIR}`)
  console.log(`Total events:    ${events.length} (24h window)`)
  console.log(`Active (5min):   ${recent.length}`)
  if (recent.length > 0) {
    const byCat = new Map<string, number>()
    for (const e of recent) byCat.set(e.signal, (byCat.get(e.signal) ?? 0) + 1)
    for (const [sig, n] of byCat) console.log(`  - ${sig}: ${n}`)
  }
}

function runCheck(): void {
  showStatus()
  const cfg = loadConfig(CONFIG_FILE)
  console.log('\nEnabled alert backends:')
  for (const [name, c] of Object.entries(cfg.alerts)) {
    const on = (c as any).enabled ? '✓' : '✗'
    console.log(`  ${on} ${name} (min_level=${(c as any).min_level})`)
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
