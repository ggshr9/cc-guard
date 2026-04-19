export interface LookupEndpoint {
  url: string
  parse: (body: string) => string | null  // returns IP or null
}

export interface IpInfo {
  ip: string
  asn: string | undefined
  country: string | undefined
  org: string | undefined
  is_datacenter: boolean
}

export const DEFAULT_ENDPOINTS: LookupEndpoint[] = [
  { url: 'https://ipinfo.io/json', parse: b => { try { return JSON.parse(b).ip ?? null } catch { return null } } },
  { url: 'https://api.ipify.org?format=json', parse: b => { try { return JSON.parse(b).ip ?? null } catch { return null } } },
  { url: 'https://icanhazip.com', parse: b => { const s = b.trim(); return /^\d+\.\d+\.\d+\.\d+$/.test(s) ? s : null } },
]

/** Take an array of IPs returned from 2-3 endpoints, return the
 *  majority-consensus IP or null if no majority. */
export function voteConsensus(ips: string[]): string | null {
  if (ips.length === 0) return null
  if (ips.length === 1) return ips[0]!
  const counts = new Map<string, number>()
  for (const ip of ips) counts.set(ip, (counts.get(ip) ?? 0) + 1)
  let best: string | null = null
  let bestCount = 0
  for (const [ip, c] of counts) {
    if (c > bestCount) { best = ip; bestCount = c }
  }
  // Require strict majority (more than half)
  return bestCount > ips.length / 2 ? best : null
}

export function classifyAsn(
  info: { asn?: string; org?: string; country?: string; ip?: string },
  datacenterAsns: Set<string>,
): IpInfo {
  const is_datacenter = !!(info.asn && datacenterAsns.has(info.asn))
  return {
    ip: info.ip ?? '',
    asn: info.asn,
    country: info.country,
    org: info.org,
    is_datacenter,
  }
}

/** Fetch current public IP by querying multiple endpoints in parallel and
 *  taking the majority consensus. Returns null if no majority was reached. */
export async function lookupPublicIp(endpoints: LookupEndpoint[]): Promise<string | null> {
  const results = await Promise.allSettled(
    endpoints.map(ep => fetch(ep.url, { signal: AbortSignal.timeout(5000) }).then(r => r.text()).then(ep.parse))
  )
  const ips = results.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : [])
  return voteConsensus(ips)
}

/** Fetch ASN + country + org for a known IP via ipinfo.io.
 *  Returns partial info (or empty) if the lookup fails — this is best-effort. */
export async function lookupIpInfo(ip: string): Promise<{ asn?: string; country?: string; org?: string }> {
  try {
    const res = await fetch(`https://ipinfo.io/${ip}/json`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return {}
    const body = await res.json() as { org?: string; country?: string }
    const out: { asn?: string; country?: string; org?: string } = {}
    const asnMatch = body.org?.match(/^(AS\d+)/)
    if (asnMatch?.[1]) out.asn = asnMatch[1]
    if (body.country) out.country = body.country
    if (body.org) out.org = body.org
    return out
  } catch {
    return {}
  }
}
