/**
 * wrap-runner.ts — side-effectful orchestration for `cc-guard wrap <cmd>`.
 *
 * Flow:
 *   1. Resolve target binary (reject if recursive).
 *   2. Read daemon state (if present) → evaluate risk.
 *   3. If risk >= auto_confirm_below AND stdin is a TTY → show banner + prompt.
 *   4. Otherwise (or after consent) → spawn target, inherit stdio, exit with its code.
 */
import { existsSync, readFileSync } from 'fs'
import { spawn } from 'child_process'
import { delimiter, join } from 'path'
import { STATE_FILE, CONFIG_FILE } from './config.ts'
import { loadConfig } from './config-loader.ts'
import { evaluateRisk, ADVICE } from './rules.ts'
import { shouldBlock, resolveBinary, renderBanner } from './wrap.ts'
import type { Event } from './events.ts'

function findOnPath(command: string): string[] {
  const pathEnv = process.env.PATH ?? ''
  const out: string[] = []
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, command)
    if (existsSync(candidate)) out.push(candidate)
  }
  return out
}

async function promptContinue(timeoutSeconds: number): Promise<'continue' | 'abort'> {
  return new Promise(resolve => {
    let settled = false
    const settle = (value: 'continue' | 'abort'): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      process.stdin.removeAllListeners('data')
      process.stdin.removeAllListeners('error')
      try { process.stdin.setRawMode?.(false) } catch {}
      process.stdin.pause()
      resolve(value)
    }
    const timer = setTimeout(() => settle('continue'), timeoutSeconds * 1000)
    process.stdin.resume()
    process.stdin.on('data', () => settle('continue'))
    process.stdin.on('error', () => settle('abort'))
    const sigintHandler = (): void => settle('abort')
    process.once('SIGINT', sigintHandler)
  })
}

export async function runWrap(argv: string[]): Promise<number> {
  if (argv.length === 0) {
    process.stderr.write('usage: cc-guard wrap <command> [args...]\n')
    return 2
  }
  const [command, ...args] = argv
  const candidates = findOnPath(command!)
  const selfPath = process.argv[1] ?? ''
  const target = resolveBinary(command!, selfPath, candidates)

  if (!target) {
    if (candidates.length === 0) {
      process.stderr.write(`[cc-guard] wrap: '${command}' not found on PATH\n`)
      return 127
    }
    process.stderr.write(`[cc-guard] wrap: no non-self candidate for '${command}' (all PATH entries resolve to cc-guard)\n`)
    return 127
  }

  // Perform risk check (non-fatal — passthrough on any failure)
  const cfg = loadConfig(CONFIG_FILE)
  let overall: 'info' | 'low' | 'medium' | 'high' = 'info'
  let activeSignals: string[] = []
  if (existsSync(STATE_FILE)) {
    try {
      const events = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Event[]
      const result = evaluateRisk(events, cfg)
      overall = result.overall
      activeSignals = result.active
    } catch {
      process.stderr.write('[cc-guard] wrap: state.json unreadable, passthrough\n')
    }
  } else {
    process.stderr.write('[cc-guard] wrap: daemon not running, passthrough\n')
  }

  const isTTY = Boolean(process.stdin.isTTY)
  const willBlock = isTTY && shouldBlock(overall, cfg.wrap.auto_confirm_below)

  if (willBlock) {
    const advice = activeSignals.length > 0
      ? ADVICE[activeSignals[0]! as keyof typeof ADVICE] ?? 'Review active signals and decide.'
      : 'Review active signals and decide.'
    process.stderr.write(renderBanner({
      overall, activeSignals, advice, timeoutSeconds: cfg.wrap.timeout_seconds,
    }) + '\n')

    const decision = await promptContinue(cfg.wrap.timeout_seconds)
    if (decision === 'abort') {
      process.stderr.write('\n[cc-guard] wrap: aborted by user\n')
      return 130
    }
  } else if (!isTTY && shouldBlock(overall, cfg.wrap.auto_confirm_below)) {
    process.stderr.write(`[cc-guard] wrap: risk ${overall.toUpperCase()} but non-TTY context — passthrough\n`)
  }

  return new Promise<number>(resolve => {
    const child = spawn(target, args, { stdio: 'inherit' })
    child.on('error', err => {
      process.stderr.write(`[cc-guard] wrap: spawn failed: ${err.message}\n`)
      resolve(127)
    })
    child.on('exit', (code, signal) => {
      if (signal) {
        // Reflect signal as 128+signum (convention)
        const num = typeof signal === 'string' ? 0 : Number(signal)
        resolve(128 + (num || 0))
      } else {
        resolve(code ?? 0)
      }
    })
  })
}
