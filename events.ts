export type Severity = 'info' | 'low' | 'medium' | 'high'

export type SignalName =
  | 'ip_change'
  | 'concurrent_session'
  | 'api_query_rate'
  | 'api_auth_failed'
  | 'api_rate_limited'
  | 'streaming_stall'
  | 'account_switch'
  | 'dns_drift'
  | 'dns_leak'

export interface Event {
  timestamp: number
  signal: SignalName
  severity: Severity
  payload: Record<string, unknown>
}

export interface Alert {
  timestamp: number
  level: Severity
  signal: SignalName
  title: string
  message: string
  advice: string
  evidence: Event[]
  fingerprint: string
}

export type AlertLevel = Severity
