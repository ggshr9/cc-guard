import { classify } from '../events-catalog'

export interface TelemetryEvent {
  event_name: string
  device_id?: string
  timestamp?: string
  [k: string]: unknown
}

/** Parse a telemetry file body (JSON objects, one per line, possibly packed
 *  as multiple top-level JSON values). Returns all parseable event_data
 *  objects; malformed lines are silently skipped. */
export function parseTelemetryFile(body: string): TelemetryEvent[] {
  const out: TelemetryEvent[] = []
  // Claude Code writes one JSON object per line. Split and parse each.
  for (const line of body.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      const parsed = JSON.parse(s)
      const ed = parsed?.event_data
      if (ed && typeof ed.event_name === 'string') {
        out.push({ event_name: ed.event_name, ...ed })
      }
    } catch { /* skip malformed */ }
  }
  return out
}

export interface CategoryTally {
  high: number
  medium: number
  low: number
  unknown: number
  byHighEvent: Record<string, number>
  unknownEvents: string[]
}

export function countByCategory(events: TelemetryEvent[]): CategoryTally {
  const tally: CategoryTally = {
    high: 0, medium: 0, low: 0, unknown: 0,
    byHighEvent: {}, unknownEvents: [],
  }
  for (const ev of events) {
    const info = classify(ev.event_name)
    tally[info.category]++
    if (info.category === 'high') {
      tally.byHighEvent[ev.event_name] = (tally.byHighEvent[ev.event_name] ?? 0) + 1
    } else if (info.category === 'unknown') {
      tally.unknownEvents.push(ev.event_name)
    }
  }
  return tally
}
