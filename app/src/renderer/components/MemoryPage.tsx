import { useEffect, useState } from 'react'
import type { MemoryEntry, MemoryKind } from '@shared/types'

const KIND_LABEL: Record<MemoryKind, string> = {
  fact: 'Fact',
  person: 'Person',
  thread: 'Open thread',
  commitment: 'Commitment'
}

export default function MemoryPage(): React.JSX.Element {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const refresh = async (): Promise<void> => {
    setEntries(await window.parla.memory.list())
  }
  useEffect(() => {
    void refresh()
  }, [])

  const saveEdit = async (id: string): Promise<void> => {
    if (draft.trim()) await window.parla.memory.update(id, { content: draft.trim() })
    setEditingId(null)
    await refresh()
  }

  const active = entries.filter((e) => e.status === 'active')
  const archived = entries.filter((e) => e.status === 'archived')

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-xl">
        <h2 className="font-display mb-1 text-3xl text-ink">Memory</h2>
        <p className="mb-6 text-xs text-ink-soft">
          What Parla remembers from your conversations. Edit or delete anything.
        </p>

        {active.length === 0 && (
          <p className="text-sm text-ink-faint">
            Nothing yet — memories appear after your conversations end.
          </p>
        )}

        {(['fact', 'person', 'thread', 'commitment'] as MemoryKind[]).map((kind) => {
          const items = active.filter((e) => e.kind === kind)
          if (items.length === 0) return null
          return (
            <section key={kind} className="mb-6">
              <h3 className="mb-2 text-xs font-medium tracking-widest text-ink-soft uppercase">
                {KIND_LABEL[kind]}s
              </h3>
              {items.map((e) => (
                <div
                  key={e.id}
                  className="group mb-1.5 flex items-start gap-2 rounded-lg border border-ink/8 bg-white/50 px-3 py-2"
                >
                  {editingId === e.id ? (
                    <div className="flex-1">
                      <input
                        value={draft}
                        autoFocus
                        onChange={(ev) => setDraft(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') void saveEdit(e.id)
                          if (ev.key === 'Escape') setEditingId(null)
                        }}
                        className="w-full rounded border border-ember/50 bg-white px-2 py-1 text-sm text-ink outline-none"
                      />
                    </div>
                  ) : (
                    <p className="flex-1 text-sm text-ink">{e.content}</p>
                  )}
                  <div className="hidden flex-shrink-0 gap-2 group-hover:flex">
                    <button
                      onClick={() => {
                        setEditingId(e.id)
                        setDraft(e.content)
                      }}
                      className="text-[11px] text-ember hover:underline"
                    >
                      edit
                    </button>
                    <button
                      onClick={() =>
                        void window.parla.memory.update(e.id, { status: 'archived' }).then(refresh)
                      }
                      className="text-[11px] text-ink-soft hover:underline"
                    >
                      archive
                    </button>
                    <button
                      onClick={() => void window.parla.memory.delete(e.id).then(refresh)}
                      className="text-[11px] text-red-500 hover:underline"
                    >
                      delete
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )
        })}

        {archived.length > 0 && (
          <details className="mt-8">
            <summary className="cursor-pointer text-xs text-ink-soft">
              Archived ({archived.length})
            </summary>
            {archived.map((e) => (
              <div key={e.id} className="mt-1.5 flex items-center gap-2 rounded-lg px-3 py-1.5">
                <p className="flex-1 text-sm text-ink-soft line-through">{e.content}</p>
                <button
                  onClick={() =>
                    void window.parla.memory.update(e.id, { status: 'active' }).then(refresh)
                  }
                  className="text-[11px] text-ember hover:underline"
                >
                  restore
                </button>
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  )
}
