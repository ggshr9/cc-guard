// Cloudflare IPv4 prefixes as of 2026-04. Subset sufficient for api.anthropic.com
// which CNAMEs to CF. Full list: https://www.cloudflare.com/ips-v4/
export const CLOUDFLARE_PREFIXES: string[] = [
  '173.245.48.', '103.21.244.', '103.22.200.', '103.31.4.',
  '141.101.64.', '108.162.192.', '190.93.240.', '188.114.96.',
  '197.234.240.', '198.41.', '162.158.', '172.64.', '172.65.',
  '172.66.', '172.67.', '131.0.72.', '104.16.', '104.17.', '104.18.',
  '104.19.', '104.20.', '104.21.', '104.22.', '104.23.', '104.24.',
  '104.25.', '104.26.', '104.27.', '104.28.',
]

// Cloudflare IPv6 prefixes. Source: https://www.cloudflare.com/ips-v6/
// Matched against normalized (lowercase, no compression) IPv6 strings.
export const CLOUDFLARE_V6_PREFIXES: string[] = [
  '2400:cb00:', '2606:4700:', '2803:f800:', '2405:b500:',
  '2405:8100:', '2a06:98c0:', '2c0f:f248:',
]

import { isIP } from 'net'

export function isIpv4(s: string): boolean { return isIP(s) === 4 }
export function isIpv6(s: string): boolean { return isIP(s) === 6 }

export function isCloudflareIp(ip: string): boolean {
  if (isIpv4(ip)) return CLOUDFLARE_PREFIXES.some(p => ip.startsWith(p))
  if (isIpv6(ip)) {
    const lower = ip.toLowerCase()
    return CLOUDFLARE_V6_PREFIXES.some(p => lower.startsWith(p))
  }
  return false
}

export function parseDigOutput(raw: string): string[] {
  return raw.split('\n')
    .map(l => l.trim())
    .filter(l => isIpv4(l) || isIpv6(l))
}

export interface LeakResult {
  leaked: boolean
  reason: string
}

/** Compare IPs seen by VPN-DNS vs IPs seen by system-DNS. If they differ
 *  substantially, DNS is leaking past the VPN (user's ISP DNS is being used). */
export function detectLeak(vpnDnsIps: string[], systemDnsIps: string[]): LeakResult {
  if (vpnDnsIps.length === 0) {
    return { leaked: false, reason: 'no VPN DNS result to compare' }
  }
  // Any IP present in one but not in the other = divergence
  const vpnSet = new Set(vpnDnsIps)
  const sysSet = new Set(systemDnsIps)
  const overlap = [...vpnSet].some(ip => sysSet.has(ip))
  if (!overlap) {
    return { leaked: true, reason: `VPN DNS returned [${vpnDnsIps.join(',')}] but system DNS returned [${systemDnsIps.join(',')}]` }
  }
  return { leaked: false, reason: 'VPN DNS and system DNS results overlap' }
}
