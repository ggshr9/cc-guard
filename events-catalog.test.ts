import { describe, it, expect } from 'vitest'
import { classify, type EventCategory } from './events-catalog'

describe('classify', () => {
  it('categorizes known high-relevance events', () => {
    expect(classify('tengu_api_query').category).toBe('high')
    expect(classify('tengu_api_auth_failed').category).toBe('high')
    expect(classify('tengu_streaming_stall').category).toBe('high')
  })

  it('categorizes known medium-relevance events', () => {
    expect(classify('tengu_bash_tool_command_executed').category).toBe('medium')
    expect(classify('tengu_file_operation').category).toBe('medium')
  })

  it('categorizes known low-relevance events', () => {
    expect(classify('tengu_config_cache_stats').category).toBe('low')
    expect(classify('tengu_repl_hook_finished').category).toBe('low')
  })

  it('returns unknown for unrecognized events', () => {
    const result = classify('tengu_some_new_unseen_event')
    expect(result.category).toBe('unknown')
    expect(result.description).toMatch(/unknown/i)
  })
})
