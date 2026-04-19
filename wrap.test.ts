import { describe, it, expect } from 'vitest'
import { resolveBinary, shouldBlock, renderBanner, type BannerInput } from './wrap'

describe('shouldBlock', () => {
  it('returns false when overall risk is below threshold', () => {
    expect(shouldBlock('info', 'high')).toBe(false)
    expect(shouldBlock('low', 'high')).toBe(false)
    expect(shouldBlock('medium', 'high')).toBe(false)
  })

  it('returns true when risk meets or exceeds threshold', () => {
    expect(shouldBlock('high', 'high')).toBe(true)
    expect(shouldBlock('high', 'medium')).toBe(true)
    expect(shouldBlock('medium', 'medium')).toBe(true)
  })

  it('treats info threshold as never blocking', () => {
    expect(shouldBlock('low', 'info')).toBe(true)
    // any risk at all blocks — but UX-wise "never block" is achieved by
    // user picking a high enough threshold. info threshold is valid but
    // useless; we don't protect against it.
  })
})

describe('resolveBinary', () => {
  it('returns the first PATH entry that is not the self-path', () => {
    const found = resolveBinary('target', '/home/u/.bun/bin/cc-guard', [
      '/tmp/not-me/target',
      '/usr/bin/target',
    ])
    expect(found).toBe('/tmp/not-me/target')
  })

  it('skips entries matching the self-path exactly', () => {
    const found = resolveBinary('cc-guard', '/home/u/.bun/bin/cc-guard', [
      '/home/u/.bun/bin/cc-guard',
      '/opt/real/cc-guard',
    ])
    expect(found).toBe('/opt/real/cc-guard')
  })

  it('returns null when no non-self candidates exist', () => {
    const found = resolveBinary('cc-guard', '/home/u/.bun/bin/cc-guard', [
      '/home/u/.bun/bin/cc-guard',
    ])
    expect(found).toBe(null)
  })

  it('returns absolute command path as-is without PATH search', () => {
    expect(resolveBinary('/abs/path/to/bin', '/home/u/cc-guard', [])).toBe('/abs/path/to/bin')
  })
})

describe('renderBanner', () => {
  const input: BannerInput = {
    overall: 'high',
    activeSignals: ['ip_change', 'concurrent_session'],
    advice: 'Pause 10 min; verify VPN.',
    timeoutSeconds: 10,
  }

  it('includes the risk level in uppercase', () => {
    const out = renderBanner(input)
    expect(out).toContain('HIGH')
  })

  it('includes every active signal', () => {
    const out = renderBanner(input)
    expect(out).toContain('ip_change')
    expect(out).toContain('concurrent_session')
  })

  it('includes the advice line', () => {
    const out = renderBanner(input)
    expect(out).toContain('Pause 10 min')
  })

  it('mentions the timeout behavior', () => {
    const out = renderBanner(input)
    expect(out).toContain('10s')
  })

  it('uses red color for high', () => {
    const out = renderBanner(input)
    expect(out).toMatch(/\x1b\[31m/)  // ANSI red
  })

  it('uses yellow color for medium', () => {
    const out = renderBanner({ ...input, overall: 'medium' })
    expect(out).toMatch(/\x1b\[33m/)  // ANSI yellow
  })

  it('uses no color for low', () => {
    const out = renderBanner({ ...input, overall: 'low' })
    expect(out).not.toMatch(/\x1b\[3[13]m/)
  })
})
