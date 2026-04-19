import { describe, it, expect, vi } from 'vitest'
import { voteConsensus, classifyAsn, type LookupEndpoint } from './ip-sink'

describe('voteConsensus', () => {
  it('returns the majority IP when 2 of 3 agree', () => {
    expect(voteConsensus(['1.1.1.1', '1.1.1.1', '2.2.2.2'])).toBe('1.1.1.1')
  })

  it('returns the single IP when only one responded', () => {
    expect(voteConsensus(['1.1.1.1'])).toBe('1.1.1.1')
  })

  it('returns null when no responses', () => {
    expect(voteConsensus([])).toBe(null)
  })

  it('returns null when all 3 disagree', () => {
    expect(voteConsensus(['1.1.1.1', '2.2.2.2', '3.3.3.3'])).toBe(null)
  })
})

describe('classifyAsn', () => {
  it('marks datacenter ASNs as is_datacenter=true', () => {
    const result = classifyAsn({ asn: 'AS14061', org: 'DigitalOcean LLC', country: 'US' }, new Set(['AS14061']))
    expect(result.is_datacenter).toBe(true)
  })

  it('marks non-DC ASNs as false', () => {
    const result = classifyAsn({ asn: 'AS4134', org: 'China Telecom', country: 'CN' }, new Set(['AS14061']))
    expect(result.is_datacenter).toBe(false)
  })

  it('handles missing asn field gracefully', () => {
    const result = classifyAsn({ asn: undefined, org: 'Unknown', country: '??' }, new Set())
    expect(result.is_datacenter).toBe(false)
  })
})
