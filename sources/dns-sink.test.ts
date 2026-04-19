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
