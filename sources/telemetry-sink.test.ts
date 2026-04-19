import { describe, it, expect } from 'vitest'
import { parseTelemetryFile, countByCategory } from './telemetry-sink'

describe('parseTelemetryFile', () => {
  it('parses a single JSON-per-line file', () => {
    const raw = [
      JSON.stringify({ event_type: 'ClaudeCodeInternalEvent', event_data: { event_name: 'tengu_api_query' } }),
      JSON.stringify({ event_type: 'ClaudeCodeInternalEvent', event_data: { event_name: 'tengu_api_success' } }),
    ].join('\n')
    const events = parseTelemetryFile(raw)
    expect(events.map(e => e.event_name)).toEqual(['tengu_api_query', 'tengu_api_success'])
  })

  it('skips malformed lines but keeps good ones', () => {
    const raw = ['not-json', JSON.stringify({ event_data: { event_name: 'tengu_api_query' } })].join('\n')
    expect(parseTelemetryFile(raw).map(e => e.event_name)).toEqual(['tengu_api_query'])
  })

  it('returns empty array for empty input', () => {
    expect(parseTelemetryFile('')).toEqual([])
  })
})

describe('countByCategory', () => {
  it('tallies events by catalog category', () => {
    const tally = countByCategory([
      { event_name: 'tengu_api_query' },
      { event_name: 'tengu_api_query' },
      { event_name: 'tengu_bash_tool_command_executed' },
      { event_name: 'tengu_config_cache_stats' },
      { event_name: 'tengu_totally_new_event' },
    ])
    expect(tally.high).toBe(2)
    expect(tally.medium).toBe(1)
    expect(tally.low).toBe(1)
    expect(tally.unknown).toBe(1)
  })

  it('tracks per-event counts for high-category events', () => {
    const tally = countByCategory([
      { event_name: 'tengu_api_query' },
      { event_name: 'tengu_api_query' },
      { event_name: 'tengu_streaming_stall' },
    ])
    expect(tally.byHighEvent.tengu_api_query).toBe(2)
    expect(tally.byHighEvent.tengu_streaming_stall).toBe(1)
  })
})
