/**
 * wrap.ts — pure logic for `cc-guard wrap <cmd> [args...]` pre-flight block mode.
 *
 * Side-effectful orchestration (actual spawn + prompt) lives in wrap-runner.ts.
 * This module is pure so it can be unit-tested without any env dependencies.
 */
import { isAbsolute, resolve as resolvePath } from 'path'
import { realpathSync } from 'fs'
import type { Severity } from './events'

const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 }

/** Return true iff `overall` risk meets or exceeds `threshold`. An `info`
 *  threshold is treated as "never block" — the lowest meaningful guard
 *  level is `low`. This avoids the foot-gun where `shouldBlock('info','info')`
 *  would otherwise return true and silently defeat passthrough. */
export function shouldBlock(overall: Severity, threshold: Severity): boolean {
  if (threshold === 'info') return false
  return SEVERITY_RANK[overall] >= SEVERITY_RANK[threshold]
}

/** Dereference symlinks when possible (realpath), fall back to resolve() for
 *  paths that don't exist (e.g. during arg validation). */
function canonicalize(path: string): string {
  try { return realpathSync(path) }
  catch { return resolvePath(path) }
}

/**
 * Resolve which binary should be exec'd. If `command` is absolute, return it
 * as-is. Otherwise, pick the first PATH entry whose resolved absolute path is
 * not the caller's self-path (to avoid recursion into cc-guard itself).
 *
 * Returns null if no acceptable candidate exists.
 */
export function resolveBinary(
  command: string,
  selfPath: string,
  pathCandidates: string[],
): string | null {
  if (isAbsolute(command)) return command
  const selfAbs = canonicalize(selfPath)
  for (const candidate of pathCandidates) {
    // Compare BOTH lexical and realpath — catches direct-path self reference
    // AND symlink redirections like `~/bin/claude → ~/.bun/bin/cc-guard`.
    const lexical = resolvePath(candidate)
    const canonical = canonicalize(candidate)
    if (lexical === selfAbs || canonical === selfAbs) continue
    return candidate
  }
  return null
}

export interface BannerInput {
  overall: Severity
  activeSignals: string[]
  advice: string
  timeoutSeconds: number
}

const HR = '─'.repeat(64)

const COLOR: Record<Severity, { open: string; close: string }> = {
  info:   { open: '', close: '' },
  low:    { open: '', close: '' },
  medium: { open: '\x1b[33m', close: '\x1b[0m' },
  high:   { open: '\x1b[31m', close: '\x1b[0m' },
}

export function renderBanner(input: BannerInput): string {
  const emoji = input.overall === 'high' ? '🚨' : input.overall === 'medium' ? '⚠️' : 'ℹ️'
  const { open, close } = COLOR[input.overall]
  const signals = input.activeSignals.length > 0
    ? input.activeSignals.map(s => `  - ${s}`).join('\n')
    : '  (no active signals)'
  return [
    HR,
    `${open}[cc-guard] ${emoji} Risk level: ${input.overall.toUpperCase()} (${input.activeSignals.length} active signals)${close}`,
    signals,
    `  → ${input.advice}`,
    '',
    `Press Enter to continue, Ctrl+C to abort.`,
    `  (auto-continue in ${input.timeoutSeconds}s if no input)`,
    HR,
  ].join('\n')
}
