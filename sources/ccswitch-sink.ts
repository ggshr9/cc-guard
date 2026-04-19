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

const MASK = (s: string): string => (s ? s.slice(0, 4) + '…' : '(empty)')

/** Check whether an account-identity-relevant field changed between two
 *  snapshots of ~/.claude.json. Watches anthropic-proxy-shaped fields
 *  (baseUrl, token) across ALL entries in mcpServers:
 *    - token OR baseUrl mutation in an existing entry → switch
 *    - newly-added entry with token or baseUrl set → switch
 *    - removal of an existing entry that had token or baseUrl → switch
 *  Returns null if no relevant change. */
export function diffAccountRelevant(a: CcSwitchConfig, b: CcSwitchConfig): AccountDiff | null {
  const aMcp = a.mcpServers ?? {}
  const bMcp = b.mcpServers ?? {}

  // Existing entries — mutation or token/url addition/removal
  for (const name of Object.keys(bMcp)) {
    const aEntry = aMcp[name]
    const bEntry = bMcp[name]!

    const aToken = String(aEntry?.token ?? '')
    const bToken = String(bEntry.token ?? '')
    if (aToken !== bToken) {
      return {
        reason: aEntry ? `token changed for server '${name}'` : `server '${name}' added with token`,
        oldValue: MASK(aToken),
        newValue: MASK(bToken),
      }
    }

    const aUrl = String(aEntry?.baseUrl ?? '')
    const bUrl = String(bEntry.baseUrl ?? '')
    if (aUrl !== bUrl) {
      return {
        reason: aEntry ? `baseUrl changed for server '${name}'` : `server '${name}' added with baseUrl`,
        oldValue: aUrl || '(empty)',
        newValue: bUrl || '(empty)',
      }
    }
  }

  // Removed entries — if they had account-identity fields, that's a switch
  for (const name of Object.keys(aMcp)) {
    if (bMcp[name]) continue  // still present, handled above
    const aEntry = aMcp[name]!
    const aToken = String(aEntry.token ?? '')
    const aUrl = String(aEntry.baseUrl ?? '')
    if (aToken || aUrl) {
      return {
        reason: `server '${name}' removed (had account fields)`,
        oldValue: aToken ? MASK(aToken) : aUrl,
        newValue: '(removed)',
      }
    }
  }

  return null
}
