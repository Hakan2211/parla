import { useParlaStore } from '@/state/store'

const STAGE: Record<string, string> = {
  idea: 'Idea',
  researching: 'Researching',
  planning: 'Planning',
  scripting: 'Scripting',
  writing: 'Writing',
  ready: 'Ready',
  published: 'Published'
}

/** "About: <Studio project>" on the start screen. Hidden when Studio isn't connected. */
export default function StudioPicker(): React.JSX.Element | null {
  const projects = useParlaStore((s) => s.studioProjects)
  const projectId = useParlaStore((s) => s.studioProjectId)
  const setProjectId = useParlaStore((s) => s.setStudioProjectId)
  const refresh = useParlaStore((s) => s.refreshStudioProjects)
  const connection = useParlaStore((s) => s.connection)

  if (projects.length === 0 && !projectId) return null
  const known = projects.some((p) => p.id === projectId)

  return (
    <label className="flex items-center gap-2.5 text-[13px] text-ink-soft">
      <span className="eyebrow">Studio project</span>
      <select
        value={projectId ?? ''}
        disabled={connection !== 'disconnected'}
        onFocus={() => void refresh()}
        onChange={(e) => setProjectId(e.target.value || null)}
        className="max-w-[340px] truncate rounded-full border border-ink/12 bg-white/60 px-4 py-1.5 text-[13.5px] text-ink outline-none focus:border-ember disabled:opacity-40"
      >
        <option value="">None: just talk</option>
        {projectId && !known && <option value={projectId}>The project from Studio</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title} · {STAGE[p.status] ?? p.status}
          </option>
        ))}
      </select>
    </label>
  )
}
