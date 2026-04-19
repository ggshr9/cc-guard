import { describe, it, expect } from 'vitest'
import { buildUnitContent, unitPath } from './install-systemd'

describe('buildUnitContent', () => {
  it('includes description and documentation', () => {
    const out = buildUnitContent('/bin/bun', ['cli.ts', 'run'])
    expect(out).toContain('Description=cc-guard')
    expect(out).toContain('Documentation=https://github.com/ggshr9/cc-guard')
  })

  it('wires ExecStart with executable and args', () => {
    const out = buildUnitContent('/home/u/.bun/bin/bun', ['/home/u/cc-guard/cli.ts', 'run'])
    expect(out).toContain('ExecStart=/home/u/.bun/bin/bun /home/u/cc-guard/cli.ts run')
  })

  it('quotes args containing spaces', () => {
    const out = buildUnitContent('/bin/bun', ['/path with space/cli.ts', 'run'])
    expect(out).toContain('"/path with space/cli.ts"')
  })

  it('includes Restart=on-failure and 10s backoff', () => {
    const out = buildUnitContent('/bin/bun', ['cli.ts', 'run'])
    expect(out).toContain('Restart=on-failure')
    expect(out).toContain('RestartSec=10s')
  })

  it('targets default.target for user-level autostart', () => {
    const out = buildUnitContent('/bin/bun', ['cli.ts', 'run'])
    expect(out).toContain('WantedBy=default.target')
  })

  it('uses journal for stdout/stderr', () => {
    const out = buildUnitContent('/bin/bun', ['cli.ts', 'run'])
    expect(out).toContain('StandardOutput=journal')
    expect(out).toContain('StandardError=journal')
  })
})

describe('unitPath', () => {
  it('points to ~/.config/systemd/user/cc-guard.service', () => {
    const path = unitPath()
    expect(path).toMatch(/\.config\/systemd\/user\/cc-guard\.service$/)
  })
})
