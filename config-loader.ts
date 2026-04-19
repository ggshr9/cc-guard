import { existsSync, readFileSync } from 'fs'
import type { Severity } from './events'

export interface ThresholdSpec {
  medium?: number | boolean
  high?: number | boolean
}

export interface CcGuardConfig {
  thresholds: {
    ip_change_cross_asn_per_hour: ThresholdSpec
    ip_change_cross_country_per_hour: ThresholdSpec
    ip_is_datacenter: ThresholdSpec
    concurrent_sessions: ThresholdSpec
    api_query_per_minute: ThresholdSpec
    streaming_stalls_per_10min: ThresholdSpec
    account_switches_per_hour: ThresholdSpec
    dns_resolv_changes_per_hour: ThresholdSpec
    dns_api_anthropic_non_cloudflare: ThresholdSpec
    dns_leak_detected: ThresholdSpec
  }
  alerts: {
    stderr:    { enabled: boolean; min_level: Severity }
    os_notify: { enabled: boolean; min_level: Severity }
    json_log:  { enabled: boolean; min_level: Severity }
    webhook:   { enabled: boolean; url: string; headers?: Record<string, string>; min_level: Severity }
    wechat_cc: { enabled: boolean; chat_id: string; wechat_cc_path?: string; min_level: Severity }
  }
  network: {
    ip_lookup_endpoints: string[]
    datacenter_asn_blocklist_url: string
    vpn_expected_dns: string | null
    sanity_check_hours: number
  }
  privacy: {
    anonymize_ip_in_logs: boolean
    send_analytics: boolean
  }
}

export const DEFAULT_CONFIG: CcGuardConfig = {
  thresholds: {
    ip_change_cross_asn_per_hour:      { medium: 2, high: 3 },
    ip_change_cross_country_per_hour:  { medium: 1, high: 2 },
    ip_is_datacenter:                  { high: true },
    concurrent_sessions:               { medium: 2, high: 3 },
    api_query_per_minute:              { medium: 60, high: 120 },
    streaming_stalls_per_10min:        { medium: 3, high: 5 },
    account_switches_per_hour:         { medium: 2, high: 5 },
    dns_resolv_changes_per_hour:       { medium: 2 },
    dns_api_anthropic_non_cloudflare:  { high: true },
    dns_leak_detected:                 { high: true },
  },
  alerts: {
    stderr:    { enabled: true,  min_level: 'low' },
    os_notify: { enabled: true,  min_level: 'medium' },
    json_log:  { enabled: true,  min_level: 'low' },
    webhook:   { enabled: false, url: '', min_level: 'high' },
    wechat_cc: { enabled: false, chat_id: '', min_level: 'medium' },
  },
  network: {
    ip_lookup_endpoints: [
      'https://ipinfo.io/json',
      'https://api.ipify.org?format=json',
      'https://icanhazip.com',
    ],
    datacenter_asn_blocklist_url: 'https://raw.githubusercontent.com/ggshr9/cc-guard/master/data/dc-asn.json',
    vpn_expected_dns: null,
    sanity_check_hours: 1,
  },
  privacy: {
    anonymize_ip_in_logs: false,
    send_analytics: false,
  },
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function mergeThreshold(user: unknown, def: ThresholdSpec): ThresholdSpec {
  if (!isObject(user)) return def
  return { ...def, ...user } as ThresholdSpec
}

export function loadConfig(file: string): CcGuardConfig {
  if (!existsSync(file)) return DEFAULT_CONFIG
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(file, 'utf8')) }
  catch { return DEFAULT_CONFIG }
  if (!isObject(parsed)) return DEFAULT_CONFIG

  const cfg: CcGuardConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
  const userThresholds = isObject(parsed.thresholds) ? parsed.thresholds : {}
  for (const key of Object.keys(cfg.thresholds) as (keyof CcGuardConfig['thresholds'])[]) {
    cfg.thresholds[key] = mergeThreshold(userThresholds[key], DEFAULT_CONFIG.thresholds[key])
  }

  const userAlerts = isObject(parsed.alerts) ? parsed.alerts : {}
  const VALID_SEVERITIES: Severity[] = ['info', 'low', 'medium', 'high']
  for (const key of Object.keys(cfg.alerts) as (keyof CcGuardConfig['alerts'])[]) {
    const u = userAlerts[key]
    if (isObject(u)) {
      // Validate min_level before merging — reject unknown severities silently
      if ('min_level' in u && !VALID_SEVERITIES.includes(u.min_level as Severity)) {
        delete u.min_level
      }
      // Cast via unknown — the alert union is keyed heterogeneously
      // (different backends have different required fields), so a single
      // merge expression can't satisfy each variant's type narrowly.
      ;(cfg.alerts as Record<string, unknown>)[key] = { ...cfg.alerts[key], ...u }
    }
  }

  if (isObject(parsed.network)) {
    cfg.network = { ...cfg.network, ...parsed.network } as CcGuardConfig['network']
  }
  if (isObject(parsed.privacy)) {
    cfg.privacy = { ...cfg.privacy, ...parsed.privacy } as CcGuardConfig['privacy']
  }

  return cfg
}
