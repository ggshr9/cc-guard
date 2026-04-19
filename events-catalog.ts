export type EventCategory = 'high' | 'medium' | 'low' | 'unknown'

export interface EventInfo {
  category: EventCategory
  description: string
  risk_note?: string
}

const CATALOG: Record<string, EventInfo> = {
  // HIGH: drives ban-risk thresholds
  'tengu_api_query':         { category: 'high', description: 'Anthropic API request initiated' },
  'tengu_api_success':       { category: 'high', description: 'API request succeeded' },
  'tengu_api_auth_failed':   { category: 'high', description: 'Authentication failed', risk_note: 'Immediate attention — possible account issue' },
  'tengu_api_rate_limited':  { category: 'high', description: 'Rate limit hit', risk_note: 'Backoff immediately' },
  'tengu_streaming_stall':   { category: 'high', description: 'Response stream stalled', risk_note: 'Common with unstable proxy' },
  'tengu_streaming_stall_summary': { category: 'high', description: 'Stream stall summary' },
  'tengu_network_retry':     { category: 'high', description: 'Network retry attempted' },

  // MEDIUM: shown in dashboard, no threshold trigger
  'tengu_bash_tool_command_executed': { category: 'medium', description: 'Bash command executed' },
  'tengu_file_operation':    { category: 'medium', description: 'File operation' },
  'tengu_file_changed':      { category: 'medium', description: 'File changed' },
  'tengu_session_file_read': { category: 'medium', description: 'Session file read' },
  'tengu_tool_use_progress': { category: 'medium', description: 'Tool use in progress' },
  'tengu_tool_use_success':  { category: 'medium', description: 'Tool completed' },
  'tengu_tool_use_error':    { category: 'medium', description: 'Tool error' },
  'tengu_cost_threshold_reached': { category: 'medium', description: 'Cost threshold reached' },

  // LOW: internal, ignore
  'tengu_config_cache_stats': { category: 'low', description: 'Config cache stats' },
  'tengu_repl_hook_finished': { category: 'low', description: 'REPL hook finished' },
  'tengu_api_cache_breakpoints': { category: 'low', description: 'API cache breakpoints' },
  'tengu_sysprompt_block':    { category: 'low', description: 'System prompt block' },
  'tengu_sysprompt_using_tool_based_cache': { category: 'low', description: 'System prompt cache flag' },
  'tengu_sysprompt_missing_boundary_marker': { category: 'low', description: 'System prompt marker flag' },
  'tengu_query_before_attachments': { category: 'low', description: 'Pre-attachment query' },
  'tengu_query_after_attachments':  { category: 'low', description: 'Post-attachment query' },
  'tengu_api_before_normalize': { category: 'low', description: 'API pre-normalize' },
  'tengu_api_after_normalize':  { category: 'low', description: 'API post-normalize' },
  'tengu_tool_use_granted_in_config': { category: 'low', description: 'Tool use granted' },
  'tengu_tool_use_can_use_tool_allowed': { category: 'low', description: 'Tool allowance check' },
  'tengu_tool_search_mode_decision': { category: 'low', description: 'Tool search mode' },
  'tengu_streaming_tool_execution_used': { category: 'low', description: 'Streaming tool exec' },
  'tengu_attachment_compute_duration': { category: 'low', description: 'Attachment compute timing' },
  'tengu_attachments':        { category: 'low', description: 'Attachments processed' },
  'tengu_input_command':      { category: 'low', description: 'Input command' },
  'tengu_tip_shown':          { category: 'low', description: 'UI tip shown' },
  'tengu_version_check_success': { category: 'low', description: 'Version check' },
  'tengu_tool_result_persisted': { category: 'low', description: 'Tool result persisted' },
  'tengu_mcp_server_connection_succeeded': { category: 'low', description: 'MCP server connected' },
  'tengu_native_version_cleanup': { category: 'low', description: 'Native cleanup' },
  'tengu_native_update_complete': { category: 'low', description: 'Native update done' },
  'tengu_native_auto_updater_start': { category: 'low', description: 'Auto-updater start' },
  'tengu_native_auto_updater_success': { category: 'low', description: 'Auto-updater success' },
}

export function classify(eventName: string): EventInfo {
  return CATALOG[eventName] ?? {
    category: 'unknown',
    description: 'unknown event — consider contributing classification upstream',
  }
}

export function allKnownEvents(): string[] {
  return Object.keys(CATALOG)
}
