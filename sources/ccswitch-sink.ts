interface McpEntry {
  baseUrl?: unknown
  token?: unknown
  command?: unknown
  args?: unknown
  [k: string]: unknown
}

interface CcSwitchConfig {
  mcpServers?: Record<string, McpEntry>
  [k: string]: unknown
}

export interface AccountDiff {
  reason: string
  oldValue: string
  newValue: string
}

/** Check whether a account-identity-relevant field changed between two
 *  snapshots of ~/.claude.json. Only watches anthropic-proxy-shaped fields
 *  (baseUrl, token). Returns null if no relevant change. */
export function diffAccountRelevant(a: CcSwitchConfig, b: CcSwitchConfig): AccountDiff | null {
  const aMcp = a.mcpServers ?? {}
  const bMcp = b.mcpServers ?? {}

  for (const name of Object.keys(bMcp)) {
    const aEntry = aMcp[name]
    const bEntry = bMcp[name]!
    if (!aEntry) continue  // newly-added server; not an account switch per se

    const aToken = String(aEntry.token ?? '')
    const bToken = String(bEntry.token ?? '')
    if (aToken && bToken && aToken !== bToken) {
      return { reason: `token changed for server '${name}'`, oldValue: aToken.slice(0, 4) + '…', newValue: bToken.slice(0, 4) + '…' }
    }

    const aUrl = String(aEntry.baseUrl ?? '')
    const bUrl = String(bEntry.baseUrl ?? '')
    if (aUrl && bUrl && aUrl !== bUrl) {
      return { reason: `baseUrl changed for server '${name}'`, oldValue: aUrl, newValue: bUrl }
    }
  }
  return null
}
