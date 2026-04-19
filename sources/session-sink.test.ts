import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { scanConcurrentSessions } from './session-sink'

const tmpDirs: string[] = []
let projectsDir: string

beforeEach(() => {
  const d = mkdtempSync(join(tmpdir(), 'cc-guard-ses-'))
  tmpDirs.push(d)
  projectsDir = join(d, 'projects')
  mkdirSync(projectsDir)
})

afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }) } catch {}
  }
})

function createProjectSession(projAlias: string, sessionName: string, mtime: Date): string {
  const pdir = join(projectsDir, projAlias)
  mkdirSync(pdir, { recursive: true })
  const file = join(pdir, `${sessionName}.jsonl`)
  writeFileSync(file, '')
  utimesSync(file, mtime, mtime)
  return file
}

describe('scanConcurrentSessions', () => {
  const now = new Date()

  it('counts 0 on empty projects dir', () => {
    expect(scanConcurrentSessions(projectsDir, 5 * 60_000).count).toBe(0)
  })

  it('counts a recently-active session as 1', () => {
    createProjectSession('-home-u-proj-a', 'abc', now)
    const result = scanConcurrentSessions(projectsDir, 5 * 60_000)
    expect(result.count).toBe(1)
    expect(result.projects).toEqual(['-home-u-proj-a'])
  })

  it('excludes sessions older than the activity window', () => {
    const stale = new Date(now.getTime() - 10 * 60_000)
    createProjectSession('-home-u-proj-a', 'old', stale)
    expect(scanConcurrentSessions(projectsDir, 5 * 60_000).count).toBe(0)
  })

  it('dedupes same-project multiple sessions to count 1', () => {
    createProjectSession('-home-u-proj-a', 'a1', now)
    createProjectSession('-home-u-proj-a', 'a2', now)
    const result = scanConcurrentSessions(projectsDir, 5 * 60_000)
    expect(result.count).toBe(1)
    expect(result.projects).toEqual(['-home-u-proj-a'])
  })

  it('counts 2 different active projects', () => {
    createProjectSession('-home-u-proj-a', 'abc', now)
    createProjectSession('-home-u-proj-b', 'xyz', now)
    const result = scanConcurrentSessions(projectsDir, 5 * 60_000)
    expect(result.count).toBe(2)
  })

  it('returns count=0 when projects dir does not exist', () => {
    expect(scanConcurrentSessions('/non/existent/path', 5 * 60_000).count).toBe(0)
  })
})
