import { useEffect, useState } from 'react'
import type { MemoryEntry, MemoryKind } from '@shared/types'
import { useParlaStore } from '@/state/store'
import { Icon, PageHeader } from './ui'

const KIND_LABEL: Record<MemoryKind, string> = {
  fact: 'Fact',
  person: 'Person',
  thread: 'Open thread',
  commitment: 'Commitment'
}

const FILTERS: { value: MemoryKind | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'fact', label: 'Facts' },
  { value: 'person', label: 'People' },
  { value: 'thread', label: 'Open threads' },
  { value: 'commitment', label: 'Commitments' }
]

function ImportanceDots({ value }: { value: number }): React.JSX.Element {
  return (
    <span className="flex gap-1" title={`Importance ${value} of 5`} aria-label={`Importance ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={'h-2 w-2 rounded-full ' + (i <= value ? 'bg-ember' : 'bg-ink/12')} />
      ))}
    </span>
  )
}

function MemoryCard({
  entry,
  onChanged
}: {
  entry: MemoryEntry
  onChanged: () => void
}): React.JSX.Element {
  const chats = useParlaStore((s) => s.chats)
  const openChat = useParlaStore((s) => s.openChat)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.content)
  const source = chats.find((c) => c.id === entry.sourceChatId)

  const save = async (): Promise<void> => {
    if (draft.trim() && draft.trim() !== entry.content)
      await window.parla.memory.update(entry.id, { content: draft.trim() })
    setEditing(false)
    onChanged()
  }

  return (
    <div className="card mb-4 break-inside-avoid px-5 pt-4 pb-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">{KIND_LABEL[entry.kind]}</span>
        <ImportanceDots value={Math.max(1, Math.min(5, entry.importance))} />
      </div>
      {editing ? (
        <textarea
          value={draft}
          autoFocus
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void save()
            }
            if (e.key === 'Escape') setEditing(false)
          }}
          className="field font-display !text-[18px]"
        />
      ) : (
        <p className="font-display text-[20px] leading-[1.3] text-ink">{entry.content}</p>
      )}
      <p className="mt-2 text-[12px] text-ink-soft">
        {source ? (
          <button onClick={() => void openChat(source.id)} className="underline decoration-ink/25 underline-offset-2 hover:text-ink">
            from: {source.title ?? 'a conversation'}
          </button>
        ) : (
          <span>from your conversations</span>
        )}
        {' · '}
        {new Date(entry.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
      </p>
      <div className="mt-3 flex items-center justify-between border-t border-ink/8 pt-2.5 text-[13.5px] text-ink">
        {editing ? (
          <>
            <button onClick={() => void save()} className="flex items-center gap-1.5 text-ember-deep hover:text-ember">
              <Icon name="check" size={16} /> Save
            </button>
            <button onClick={() => setEditing(false)} className="text-ink-soft hover:text-ink">
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                setDraft(entry.content)
                setEditing(true)
              }}
              className="flex items-center gap-1.5 hover:text-ember-deep"
            >
              <Icon name="edit" size={16} /> Edit
            </button>
            <button
              onClick={() => void window.parla.memory.update(entry.id, { status: 'archived' }).then(onChanged)}
              className="flex items-center gap-1.5 hover:text-red-700"
              title="Parla stops using this. You can restore it below."
            >
              <Icon name="trash" size={16} /> Forget
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function MemoryPage(): React.JSX.Element {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [filter, setFilter] = useState<MemoryKind | 'all'>('all')

  const refresh = async (): Promise<void> => {
    setEntries(await window.parla.memory.list())
  }
  useEffect(() => {
    void refresh()
  }, [])

  const active = entries
    .filter((e) => e.status === 'active' && (filter === 'all' || e.kind === filter))
    .sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt)
  const archived = entries.filter((e) => e.status === 'archived')

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-10 pt-10 pb-16">
        <PageHeader
          title="What Parla remembers"
          sub="Everything here came from your conversations. Edit or forget anything."
        />
        <div className="mb-6 flex flex-wrap gap-2 border-b border-ink/8 pb-5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={
                'rounded-full border px-4 py-1.5 text-[13.5px] transition ' +
                (filter === f.value
                  ? 'border-ember bg-ember text-white'
                  : 'border-ink/12 bg-white/45 text-ink hover:bg-white/80')
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        {active.length === 0 && (
          <p className="font-display text-[17px] text-ink-soft italic">
            {entries.length === 0
              ? 'Nothing yet. Memories appear after your conversations end.'
              : 'Nothing in this category.'}
          </p>
        )}

        <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
          {active.map((e) => (
            <MemoryCard key={e.id} entry={e} onChanged={() => void refresh()} />
          ))}
        </div>

        {archived.length > 0 && (
          <details className="mt-8">
            <summary className="eyebrow cursor-pointer">Forgotten ({archived.length})</summary>
            <div className="mt-3 space-y-1">
              {archived.map((e) => (
                <div key={e.id} className="flex items-center gap-3 rounded-lg px-3 py-1.5 hover:bg-white/40">
                  <p className="font-display flex-1 text-[15px] text-ink-soft line-through">{e.content}</p>
                  <button
                    onClick={() => void window.parla.memory.update(e.id, { status: 'active' }).then(refresh)}
                    className="text-[12px] text-ember-deep hover:underline"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => void window.parla.memory.delete(e.id).then(refresh)}
                    className="text-[12px] text-red-700 hover:underline"
                  >
                    Delete forever
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
