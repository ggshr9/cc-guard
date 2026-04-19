import { homedir } from 'os'
import { join } from 'path'

/** Root state dir — all cc-guard persistent files live here. */
export const STATE_DIR =
  process.env.CC_GUARD_STATE_DIR ??
  join(homedir(), '.claude', 'channels', 'cc-guard')

export const CONFIG_FILE       = join(STATE_DIR, 'config.json')
export const CONFIG_EXAMPLE    = join(STATE_DIR, 'config.example.json')
export const STATE_FILE        = join(STATE_DIR, 'state.json')
export const ALERTS_LOG        = join(STATE_DIR, 'alerts.log')
export const UNKNOWN_EVENTS    = join(STATE_DIR, 'unknown_events.log')
export const PID_FILE          = join(STATE_DIR, 'daemon.pid')

/** Paths we observe but do not modify. */
export const CLAUDE_HOME          = join(homedir(), '.claude')
export const CLAUDE_CONFIG        = join(homedir(), '.claude.json')
export const CLAUDE_TELEMETRY_DIR = join(CLAUDE_HOME, 'telemetry')
export const CLAUDE_STATSIG_DIR   = join(CLAUDE_HOME, 'statsig')
export const CLAUDE_PROJECTS_DIR  = join(CLAUDE_HOME, 'projects')

/** DNS resolver config (Linux); macOS uses `scutil --dns` instead of a file. */
export const RESOLV_CONF = '/etc/resolv.conf'

/** Bundled datacenter ASN blocklist path (relative to repo root). */
export const DC_ASN_FILE = join(import.meta.dirname ?? '.', 'data', 'dc-asn.json')

/** Ring-buffer hard limits. */
export const MAX_EVENTS      = 10_000
export const RETENTION_MS    = 24 * 60 * 60 * 1000  // 24h
export const FLUSH_INTERVAL_MS = 60_000
