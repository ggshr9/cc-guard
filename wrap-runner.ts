/**
 * wrap-runner.ts — side-effectful orchestration for `cc-guard wrap <cmd>`.
 *
 * Fail-open contract: any unexpected error in the risk-check / prompt path
 * MUST fall through to spawn the wrapped command. The guard is an advisory
 * layer — it never blocks execution due to its own bugs.
 */
import { existsSync, readFileSync } from 'fs'
import { spawn } from 'child_process'
import { delimiter, join } from 'path'
import { STATE_FILE, CONFIG_FILE, PID_FILE } from './config.ts'
import { loadConfig } from './config-loader.ts'
import { evaluateRisk, ADVICE } from './rules.ts'
import { shouldBlock, resolveBinary, renderBanner } from './wrap.ts'
import type { Event, Severity } from './events.ts'

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

/** Best-effort check: is the daemon process alive? Reads PID_FILE and
 *  signals pid 0. Stale PID file or missing PID → returns false so wrap
 *  treats state.json as unreliable. */
function isDaemonAlive(): boolean {
  if (!existsSync(PID_FILE)) return false
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10)
    if (!Number.isFinite(pid) || pid <= 0) return false
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Signal name → number for exit code computation. */
const SIGNAL_NUMBERS: Record<string, number> = {
  SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGTRAP: 5, SIGABRT: 6,
  SIGBUS: 7, SIGFPE: 8, SIGKILL: 9, SIGUSR1: 10, SIGSEGV: 11, SIGUSR2: 12,
  SIGPIPE: 13, SIGALRM: 14, SIGTERM: 15,
}

export function exitCodeForSignal(signal: string | null): number {
  if (!signal) return 0
  const num = SIGNAL_NUMBERS[signal] ?? 0
  return 128 + num
}

async function promptContinue(timeoutSeconds: number): Promise<'continue' | 'abort'> {
  return new Promise(resolve => {
    let settled = false
    const onSigint = (): void => settle('abort')
    const settle = (value: 'continue' | 'abort'): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      process.stdin.removeAllListeners('data')
      process.stdin.removeAllListeners('error')
      process.removeListener('SIGINT', onSigint)
      try { process.stdin.setRawMode?.(false) } catch {}
      process.stdin.pause()
      resolve(value)
    }
    const timer = setTimeout(() => settle('continue'), timeoutSeconds * 1000)
    try {
      process.stdin.resume()
      process.stdin.on('data', () => settle('continue'))
      process.stdin.on('error', () => settle('abort'))
      process.once('SIGINT', onSigint)
    } catch {
      // Unexpected stdin state — fail open
      settle('continue')
    }
  })
}

interface RiskCheck {
  overall: Severity
  active: string[]
}

/** Read daemon state + config, compute risk. Fail-open: any error → info
 *  risk (treated as passthrough). */
function assessRisk(): { cfg: ReturnType<typeof loadConfig>; risk: RiskCheck; daemonAlive: boolean } {
  let cfg = loadConfig(CONFIG_FILE)
  const daemonAlive = isDaemonAlive()
  let risk: RiskCheck = { overall: 'info', active: [] }

  if (!daemonAlive) {
    process.stderr.write('[cc-guard] wrap: daemon not running, passthrough\n')
    return { cfg, risk, daemonAlive }
  }

  if (existsSync(STATE_FILE)) {
    try {
      const events = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Event[]
      if (Array.isArray(events)) {
        const result = evaluateRisk(events, cfg)
        risk = { overall: result.overall, active: result.active }
      }
    } catch {
      process.stderr.write('[cc-guard] wrap: state.json unreadable, passthrough\n')
    }
  }
  return { cfg, risk, daemonAlive }
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

  // Risk check + optional banner — entire block is fail-open. Any unexpected
  // exception falls through to the spawn below so the wrapped command
  // always runs.
  try {
    const { cfg, risk, daemonAlive } = assessRisk()
    const isTTY = Boolean(process.stdin.isTTY)
    const willBlock = daemonAlive && isTTY && shouldBlock(risk.overall, cfg.wrap.auto_confirm_below)

    if (willBlock) {
      const advice = risk.active.length > 0
        ? ADVICE[risk.active[0]! as keyof typeof ADVICE] ?? 'Review active signals and decide.'
        : 'Review active signals and decide.'
      process.stderr.write(renderBanner({
        overall: risk.overall,
        activeSignals: risk.active,
        advice,
        timeoutSeconds: cfg.wrap.timeout_seconds,
      }) + '\n')

      const decision = await promptContinue(cfg.wrap.timeout_seconds)
      if (decision === 'abort') {
        process.stderr.write('\n[cc-guard] wrap: aborted by user\n')
        return 130
      }
    } else if (!isTTY && daemonAlive && shouldBlock(risk.overall, cfg.wrap.auto_confirm_below)) {
      process.stderr.write(`[cc-guard] wrap: risk ${risk.overall.toUpperCase()} but non-TTY context — passthrough\n`)
    }
  } catch (err) {
    process.stderr.write(`[cc-guard] wrap: risk check failed (${err instanceof Error ? err.message : String(err)}), passthrough\n`)
  }

  return new Promise<number>(resolve => {
    const child = spawn(target, args, { stdio: 'inherit' })
    child.on('error', err => {
      process.stderr.write(`[cc-guard] wrap: spawn failed: ${err.message}\n`)
      resolve(127)
    })
    child.on('exit', (code, signal) => {
      if (signal) {
        resolve(exitCodeForSignal(signal))
      } else {
        resolve(code ?? 0)
      }
    })
  })
}
