/**
 * install-systemd.ts — generate ~/.config/systemd/user/cc-guard.service
 *
 * Usage:  cc-guard install-systemd-unit
 *
 * Generates a systemd user unit that runs `cc-guard run` in the foreground
 * under systemd's supervision. Users then `systemctl --user enable --now
 * cc-guard` to persist across logins.
 *
 * On non-Linux or systems without systemd, prints a helpful message pointing
 * at tmux / nohup alternatives.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { homedir, platform } from 'os'
import { join, dirname } from 'path'
import { spawnSync } from 'child_process'

/** The path we write the unit to. Exposed for tests. */
export function unitPath(): string {
  return join(homedir(), '.config', 'systemd', 'user', 'cc-guard.service')
}

/** Return the unit file content string. Pure — exposed for tests. */
export function buildUnitContent(executable: string, args: string[]): string {
  const escapedArgs = args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')
  return `[Unit]
Description=cc-guard — Claude Code session health monitor
Documentation=https://github.com/ggshr9/cc-guard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${executable} ${escapedArgs}
Restart=on-failure
RestartSec=10s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`
}

function hasSystemctl(): boolean {
  if (platform() !== 'linux') return false
  const res = spawnSync('systemctl', ['--user', '--version'], { stdio: 'ignore' })
  return res.status === 0
}

export function installSystemdUnit(opts: { force?: boolean } = {}): number {
  if (!hasSystemctl()) {
    process.stderr.write(
      platform() === 'linux'
        ? '[cc-guard] install-systemd-unit: systemctl --user not available. Falling back to tmux / nohup:\n'
        : `[cc-guard] install-systemd-unit: systemd is Linux-only (current platform: ${platform()}).\n`
    )
    process.stderr.write('  tmux new -d -s cc-guard "cc-guard run"\n')
    process.stderr.write('  nohup cc-guard run &> ~/cc-guard.log &\n')
    return 1
  }

  const target = unitPath()
  if (existsSync(target) && !opts.force) {
    process.stderr.write(`[cc-guard] ${target} already exists. Pass --force to overwrite.\n`)
    return 1
  }

  // Locate cc-guard executable: prefer the currently-running one, fall back to PATH
  const executable = process.execPath
  const scriptPath = process.argv[1] ?? ''
  const args = scriptPath ? [scriptPath, 'run'] : ['run']

  const content = buildUnitContent(executable, args)
  const dir = dirname(target)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(target, content, { mode: 0o644 })

  process.stdout.write(`[cc-guard] Wrote ${target}\n`)
  process.stdout.write('\nNext steps:\n')
  process.stdout.write('  systemctl --user daemon-reload\n')
  process.stdout.write('  systemctl --user enable --now cc-guard\n')
  process.stdout.write('  systemctl --user status cc-guard   # verify\n')
  process.stdout.write('  journalctl --user -u cc-guard -f   # live logs\n')
  return 0
}
