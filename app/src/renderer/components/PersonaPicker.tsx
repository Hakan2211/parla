import { useParlaStore } from '@/state/store'

export default function PersonaPicker(): React.JSX.Element {
  const personas = useParlaStore((s) => s.personas)
  const activeId = useParlaStore((s) => s.activePersonaId)
  const setActive = useParlaStore((s) => s.setActivePersonaId)
  const connection = useParlaStore((s) => s.connection)

  if (personas.length === 0) return <></>

  return (
    <div className="flex flex-wrap items-center justify-center gap-2.5">
      {personas.map((p) => {
        const active = p.id === activeId || (activeId === null && p === personas[0])
        return (
          <button
            key={p.id}
            disabled={connection !== 'disconnected'}
            onClick={() => setActive(p.id)}
            aria-pressed={active}
            className={
              'flex items-center gap-2.5 rounded-full border px-5 py-2 text-[14px] transition disabled:opacity-40 ' +
              (active
                ? 'border-ember bg-white/85 text-ink shadow-sm'
                : 'border-transparent bg-white/55 text-ink hover:bg-white/80')
            }
          >
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
            {p.name}
          </button>
        )
      })}
    </div>
  )
}
