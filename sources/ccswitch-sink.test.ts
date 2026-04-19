import { describe, it, expect } from 'vitest'
import { diffAccountRelevant } from './ccswitch-sink'

describe('diffAccountRelevant', () => {
  it('returns null when mcpServers unchanged', () => {
    const a = { mcpServers: { anthropic: { baseUrl: 'https://api.anthropic.com', token: 'T1' } } }
    const b = { mcpServers: { anthropic: { baseUrl: 'https://api.anthropic.com', token: 'T1' } } }
    expect(diffAccountRelevant(a, b)).toBe(null)
  })

  it('detects token change', () => {
    const a = { mcpServers: { anthropic: { baseUrl: 'https://api.anthropic.com', token: 'T1' } } }
    const b = { mcpServers: { anthropic: { baseUrl: 'https://api.anthropic.com', token: 'T2' } } }
    const d = diffAccountRelevant(a, b)
    expect(d).not.toBe(null)
    expect(d?.reason).toMatch(/token/)
  })

  it('detects baseUrl change', () => {
    const a = { mcpServers: { anthropic: { baseUrl: 'https://api.anthropic.com', token: 'T1' } } }
    const b = { mcpServers: { anthropic: { baseUrl: 'https://proxy.example.com', token: 'T1' } } }
    const d = diffAccountRelevant(a, b)
    expect(d).not.toBe(null)
    expect(d?.reason).toMatch(/url/i)
  })

  it('ignores unrelated mcpServers edits', () => {
    const a = { mcpServers: { anthropic: { baseUrl: 'x', token: 'T1' } } }
    const b = { mcpServers: { anthropic: { baseUrl: 'x', token: 'T1' }, wechat: { command: 'bun' } } }
    expect(diffAccountRelevant(a, b)).toBe(null)
  })

  it('ignores top-level fields outside mcpServers', () => {
    const a = { mcpServers: { anthropic: { token: 'T1' } }, someOther: 1 }
    const b = { mcpServers: { anthropic: { token: 'T1' } }, someOther: 2 }
    expect(diffAccountRelevant(a, b)).toBe(null)
  })
})
