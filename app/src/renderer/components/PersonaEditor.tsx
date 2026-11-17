import { useState } from 'react'
import type { Persona } from '@shared/types'
import { useParlaStore } from '@/state/store'

const KOKORO_VOICES = [
  'af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky',
  'am_adam', 'am_michael', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis'
]

// Muted, warm-leaning palette that sits well on the cream theme.
const COLORS = ['#bf5f3d', '#d99a3d', '#7d9a6f', '#7e9ec9', '#9a6b8f', '#5f9a94', '#b0563d']

export default function PersonaEditor(): React.JSX.Element {
  const personas = useParlaStore((s) => s.personas)
  const refresh = useParlaStore((s) => s.refreshPersonas)
  const [editing, setEditing] = useState<Persona | 'new' | null>(null)
  const [form, setForm] = useState({ name: '', systemPrompt: '', voiceId: 'af_heart', color: COLORS[0] })

  const startEdit = (p: Persona | 'new'): void => {
    setEditing(p)
    if (p === 'new') {
      setForm({ name: '', systemPrompt: '', voiceId: 'af_heart', color: COLORS[0] })
    } else {
      setForm({ name: p.name, systemPrompt: p.systemPrompt, voiceId: p.voiceId, color: p.color })
    }
  }

  const save = async (): Promise<void> => {
    if (!form.name.trim() || !form.systemPrompt.trim()) return
    if (editing === 'new') {
      await window.parla.personas.create(form)
    } else if (editing) {
      await window.parla.personas.update(editing.id, form)
    }
    setEditing(null)
    await refresh()
  }

  const remove = async (p: Persona): Promise<void> => {
    await window.parla.personas.delete(p.id)
    await refresh()
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-3xl text-ink">Personas</h2>
          <button
            onClick={() => startEdit('new')}
            className="rounded-lg bg-ember px-3 py-1.5 text-sm text-white hover:bg-ember-deep"
          >
            + New persona
          </button>
        </div>

        {personas.map((p) => (
          <div key={p.id} className="mb-2 flex items-center gap-3 rounded-lg border border-ink/8 bg-white/50 px-4 py-3">
            <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink">
                {p.name}
                {p.isBuiltin && <span className="ml-2 text-[10px] text-ink-soft uppercase">builtin</span>}
              </div>
              <div className="truncate text-xs text-ink-soft">
                {p.voiceId} · {p.systemPrompt.slice(0, 80)}
              </div>
            </div>
            <button onClick={() => startEdit(p)} className="text-xs text-ember hover:underline">
              Edit
            </button>
            {!p.isBuiltin && (
              <button onClick={() => void remove(p)} className="text-xs text-red-500 hover:underline">
                Delete
              </button>
            )}
          </div>
        ))}

        {editing && (
          <div className="mt-6 rounded-xl border border-ink/15 bg-white/70 p-5">
            <h3 className="mb-3 text-sm font-medium text-ink">
              {editing === 'new' ? 'New persona' : `Edit ${editing.name}`}
            </h3>
            <div className="space-y-3">
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Name"
                className="w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm text-ink outline-none focus:border-ember/60"
              />
              <textarea
                value={form.systemPrompt}
                onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                placeholder="System prompt — who is this persona? Remind them they're speaking out loud."
                rows={5}
                className="w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm text-ink outline-none focus:border-ember/60"
              />
              <div className="flex items-center gap-3">
                <select
                  value={form.voiceId}
                  onChange={(e) => setForm((f) => ({ ...f, voiceId: e.target.value }))}
                  className="rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm text-ink"
                >
                  {KOKORO_VOICES.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <div className="flex gap-1.5">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setForm((f) => ({ ...f, color: c }))}
                      className={'h-6 w-6 rounded-full border-2 ' + (form.color === c ? 'border-ink' : 'border-transparent')}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => void save()} className="rounded-lg bg-ember px-4 py-2 text-sm text-white hover:bg-ember-deep">
                  Save
                </button>
                <button onClick={() => setEditing(null)} className="rounded-lg border border-ink/15 px-4 py-2 text-sm text-ink">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
