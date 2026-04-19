import { describe, it, expect } from 'vitest'
import { isCloudflareIp, parseDigOutput, detectLeak } from './dns-sink'

describe('isCloudflareIp', () => {
  it('matches known Cloudflare ranges', () => {
    expect(isCloudflareIp('104.16.132.229')).toBe(true)
    expect(isCloudflareIp('172.67.12.34')).toBe(true)
    expect(isCloudflareIp('198.41.200.1')).toBe(true)
  })

  it('rejects non-Cloudflare IPs', () => {
    expect(isCloudflareIp('8.8.8.8')).toBe(false)
    expect(isCloudflareIp('1.1.1.1')).toBe(false)  // CF public DNS, not CDN
    expect(isCloudflareIp('192.168.1.1')).toBe(false)
  })
})

describe('parseDigOutput', () => {
  it('extracts A records from dig +short output', () => {
    expect(parseDigOutput('104.16.132.229\n104.16.133.229\n')).toEqual(['104.16.132.229', '104.16.133.229'])
  })

  it('ignores comments and empty lines', () => {
    expect(parseDigOutput('\n; comment\n104.16.132.229\n')).toEqual(['104.16.132.229'])
  })

  it('returns empty array on malformed output', () => {
    expect(parseDigOutput('not an ip')).toEqual([])
  })
})

describe('detectLeak', () => {
  it('reports leak when VPN DNS result differs from system DNS result', () => {
    const result = detectLeak(['104.16.132.229'], ['1.2.3.4'])
    expect(result.leaked).toBe(true)
  })

  it('no leak when results match', () => {
    const result = detectLeak(['104.16.132.229'], ['104.16.132.229'])
    expect(result.leaked).toBe(false)
  })

  it('handles empty VPN DNS gracefully (cannot detect)', () => {
    const result = detectLeak([], ['104.16.132.229'])
    expect(result.leaked).toBe(false)
    expect(result.reason).toMatch(/no vpn/i)
  })
})

describe('IPv6 support', () => {
  it('isCloudflareIp matches IPv6 Cloudflare prefixes', () => {
    expect(isCloudflareIp('2400:cb00::1')).toBe(true)
    expect(isCloudflareIp('2606:4700:20::ac43:4a1f')).toBe(true)
    expect(isCloudflareIp('2400:CB00::1')).toBe(true)  // case-insensitive
  })

  it('isCloudflareIp rejects non-CF IPv6', () => {
    expect(isCloudflareIp('2001:4860:4860::8888')).toBe(false)  // Google DNS
    expect(isCloudflareIp('2606:4700:e:' + 'invalid')).toBe(false)  // malformed
  })

  it('parseDigOutput extracts mixed IPv4 + IPv6 records', () => {
    const raw = '104.16.132.229\n2606:4700:20::ac43:4a1f\n; comment\n'
    expect(parseDigOutput(raw)).toEqual(['104.16.132.229', '2606:4700:20::ac43:4a1f'])
  })

  it('parseDigOutput accepts IPv6 alone', () => {
    expect(parseDigOutput('2400:cb00::1\n')).toEqual(['2400:cb00::1'])
  })
})
