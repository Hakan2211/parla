import { useParlaStore } from '@/state/store'

export default function PersonaPicker(): React.JSX.Element {
  const personas = useParlaStore((s) => s.personas)
  const activeId = useParlaStore((s) => s.activePersonaId)
  const setActive = useParlaStore((s) => s.setActivePersonaId)
  const connection = useParlaStore((s) => s.connection)

  if (personas.length === 0) return <></>

  return (
    <div className="flex items-center justify-center gap-2">
      {personas.map((p) => {
        const active = p.id === activeId || (activeId === null && p === personas[0])
        return (
          <button
            key={p.id}
            disabled={connection !== 'disconnected'}
            onClick={() => setActive(p.id)}
            className={
              'flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs transition disabled:opacity-40 ' +
              (active
                ? 'border-ember/40 bg-white/80 font-medium text-ink shadow-sm'
                : 'border-ink/10 text-ink-soft hover:border-ink/25 hover:bg-white/50')
            }
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: p.color }}
            />
            {p.name}
          </button>
        )
      })}
    </div>
  )
}
