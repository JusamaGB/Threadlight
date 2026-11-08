import { describe, expect, it, vi } from 'vitest'
import { CommunicationCatalog } from '../src/main/communication/catalog'
import type { CatalogEntry, ThreadAdapter } from '../src/main/threadRead/types'

function adapter(provider: 'claude' | 'codex', count: number): ThreadAdapter {
  const entries: CatalogEntry[] = Array.from({ length: count }, (_, index) => ({
    nativeId: `${provider}-${index}`,
    provider,
    title: `Worker ${index}`,
    titleSource: 'explicit',
    workspace: 'C:/test-project',
    archived: false,
    lastActiveAt: index,
  }))
  return {
    provider,
    catalog: vi.fn(async (cursor?: string) => {
      const offset = Number(cursor ?? 0)
      return {
        entries: entries.slice(offset, offset + 50),
        sources: [],
        complete: offset + 50 >= entries.length,
        next: offset + 50 < entries.length ? String(offset + 50) : undefined,
      }
    }),
    locate: vi.fn(async (id) => entries.find((entry) => entry.nativeId === id) ?? null),
    read: vi.fn(),
  }
}

describe('communication destination discovery', () => {
  it('keeps Codex discoverable after a large Claude catalogue and bounds each provider', async () => {
    const claude = adapter('claude', 150)
    const codex = adapter('codex', 2)
    const catalog = new CommunicationCatalog(
      [claude, codex],
      () => ['claude', 'codex'],
      () => undefined,
    )
    const found = await catalog.find()
    expect(found.filter((row) => row.provider === 'claude')).toHaveLength(100)
    expect(found.filter((row) => row.provider === 'codex').map((row) => row.id)).toEqual([
      'codex:codex-0',
      'codex:codex-1',
    ])
    expect(claude.catalog).toHaveBeenCalledTimes(2)
    expect(found.every((row) => !row.send && !row.queue)).toBe(true)
  })

  it('exposes CLI threads with unknown archive status and uses only a verified runtime for their live route', async () => {
    const claude = adapter('claude', 1),
      row = (await claude.locate('claude-0'))!
    row.archived = 'unknown'
    const admitted = vi.fn(async () => true),
      runtime = vi.fn(async () => undefined)
    const catalog = new CommunicationCatalog(
      [claude],
      () => ['claude'],
      () => undefined,
      admitted,
      async () => false,
      runtime,
    )
    expect(await catalog.find(undefined, 'Worker')).toHaveLength(1)
    expect((await catalog.find(row.nativeId))[0]).toMatchObject({ send: false, queue: false })
    expect(admitted).not.toHaveBeenCalled()
    expect(runtime).toHaveBeenCalledWith(row.nativeId)
  })
  it('finds a new Claude target whose catalog has not been loaded', async () => {
    const claude = adapter('claude', 2)
    vi.mocked(claude.locate).mockResolvedValueOnce(null)
    const catalog = new CommunicationCatalog(
      [claude],
      () => ['claude'],
      () => undefined,
    )
    expect((await catalog.find('claude-1')).map((row) => row.id)).toEqual(['claude-1'])
    expect(claude.catalog).toHaveBeenCalledOnce()
  })
  it('filters before limiting and preserves exact lookup beyond the browse limit', async () => {
    const claude = adapter('claude', 150)
    const codex = adapter('codex', 2)
    const catalog = new CommunicationCatalog(
      [claude, codex],
      () => ['claude'],
      () => undefined,
    )
    expect((await catalog.find(undefined, 'Worker 149')).map((row) => row.id)).toEqual([
      'claude-149',
    ])
    expect((await catalog.find('claude-149')).map((row) => row.id)).toEqual(['claude-149'])
    expect(codex.catalog).not.toHaveBeenCalled()
    expect(codex.locate).not.toHaveBeenCalled()
  })
})
