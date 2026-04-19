import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

export interface ConcurrentScanResult {
  count: number
  projects: string[]
}

/** Scan Claude Code projects dir, count distinct projects with a jsonl
 *  modified within the last `activeWindowMs`. */
export function scanConcurrentSessions(projectsDir: string, activeWindowMs: number): ConcurrentScanResult {
  if (!existsSync(projectsDir)) return { count: 0, projects: [] }
  const cutoff = Date.now() - activeWindowMs
  const active = new Set<string>()

  let entries: string[] = []
  try { entries = readdirSync(projectsDir) } catch { return { count: 0, projects: [] } }

  for (const entry of entries) {
    const full = join(projectsDir, entry)
    let stat
    try { stat = statSync(full) } catch { continue }
    if (!stat.isDirectory()) continue

    let children: string[] = []
    try { children = readdirSync(full) } catch { continue }

    for (const child of children) {
      if (!child.endsWith('.jsonl')) continue
      try {
        const ch = statSync(join(full, child))
        if (ch.mtimeMs >= cutoff) {
          active.add(entry)
          break  // one active jsonl is enough to mark the project active
        }
      } catch {}
    }
  }

  return { count: active.size, projects: [...active] }
}
