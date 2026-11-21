import { useEffect, useState } from 'react'
import type { Persona } from '@shared/types'
import { useParlaStore } from '@/state/store'
import { BlobArt, Icon, PageHeader, VOICES, useVoicePreview, voiceName } from './ui'

// Muted, warm-leaning palette that sits well on the cream theme.
const COLORS = ['#e8a383', '#d9825f', '#8fa67f', '#b7b2dc', '#7f78b8', '#e2b65a', '#d98f7c', '#6f9c9e']

const BUILTIN_TRAITS: Record<string, string> = {
  'builtin-friend': 'warm, curious',
  'builtin-coach': 'direct, energizing',
  'builtin-thinker': 'reflective, socratic'
}

interface Form {
  name: string
  systemPrompt: string
  voiceId: string
  color: string
}

const EMPTY: Form = { name: '', systemPrompt: '', voiceId: 'af_heart', color: COLORS[0] }

function PersonaCard({
  persona,
  selected,
  onSelect
}: {
  persona: Persona
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const preview = useVoicePreview()
  const traits = BUILTIN_TRAITS[persona.id]
  return (
    <div
      onClick={onSelect}
      className={
        'card cursor-pointer overflow-hidden transition ' +
        (selected ? '!border-ember ring-1 ring-ember' : 'hover:-translate-y-0.5')
      }
    >
      <BlobArt seed={persona.id} color={persona.color} className="h-32 w-full" />
      <div className="px-5 pb-3">
        <h3 className="font-display text-[23px] leading-tight text-ink">{persona.name}</h3>
        <p className="mt-0.5 h-5 truncate text-[13px] text-ink-soft">{traits ?? (persona.isBuiltin ? '' : 'your own')}</p>
        <div className="mt-3 flex items-center gap-2 border-t border-ink/8 pt-2.5 text-[12.5px] text-ink-soft">
          <button
            onClick={(e) => {
              e.stopPropagation()
              preview.toggle(persona.voiceId, `Hi, I'm ${persona.name}. What's on your mind?`)
            }}
            title="Preview voice"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-ink/25 text-ink hover:border-ember hover:text-ember"
          >
            <Icon
              name={preview.playing === persona.voiceId ? 'pause' : 'play'}
              size={11}
              strokeWidth={2}
              className={preview.loading === persona.voiceId ? 'animate-pulse' : ''}
            />
          </button>
          Voice: {voiceName(persona.voiceId)}
        </div>
      </div>
    </div>
  )
}

export default function PersonaEditor(): React.JSX.Element {
  const personas = useParlaStore((s) => s.personas)
  const refresh = useParlaStore((s) => s.refreshPersonas)
  const [selected, setSelected] = useState<Persona | 'new' | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [savedFlash, setSavedFlash] = useState(false)
  const preview = useVoicePreview()

  const select = (p: Persona | 'new'): void => {
    setSelected(p)
    setForm(
      p === 'new'
        ? EMPTY
        : { name: p.name, systemPrompt: p.systemPrompt, voiceId: p.voiceId, color: p.color }
    )
  }

  // Open the first persona in the editor by default.
  useEffect(() => {
    if (selected === null && personas[0]) select(personas[0])
  }, [personas, selected])

  const save = async (): Promise<void> => {
    if (!form.name.trim() || !form.systemPrompt.trim()) return
    if (selected === 'new') {
      const created = await window.parla.personas.create(form)
      await refresh()
      select(created)
    } else if (selected) {
      const updated = await window.parla.personas.update(selected.id, form)
      await refresh()
      if (updated) select(updated)
    }
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1400)
  }

  const remove = async (p: Persona): Promise<void> => {
    await window.parla.personas.delete(p.id)
    setSelected(null)
    await refresh()
  }

  const selectedId = selected === 'new' ? 'new' : selected?.id
  const canSave = form.name.trim() !== '' && form.systemPrompt.trim() !== ''

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto px-10 pt-10 pb-12">
        <PageHeader
          eyebrow="Personas"
          title="Your conversation companions"
          sub="Different perspectives, voices, and energies for whatever you need to talk about."
        />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
          {personas.map((p) => (
            <PersonaCard key={p.id} persona={p} selected={selectedId === p.id} onSelect={() => select(p)} />
          ))}
          <button
            onClick={() => select('new')}
            className={
              'flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-[18px] border-[1.5px] border-dashed text-ink transition ' +
              (selectedId === 'new' ? 'border-ember bg-white/50' : 'border-ink/18 hover:border-ink/35 hover:bg-white/30')
            }
          >
            <Icon name="plus" size={28} strokeWidth={1.2} />
            <span className="font-display text-[18px]">New persona</span>
          </button>
        </div>
      </div>

      {selected && (
        <aside className="card my-3 mr-3 flex w-[380px] flex-shrink-0 flex-col overflow-y-auto px-7 py-7">
          <p className="eyebrow">{selected === 'new' ? 'New persona' : 'Edit persona'}</p>
          <h2 className="font-display mt-1 mb-5 text-[32px] leading-tight text-ink">
            {form.name.trim() || 'Untitled'}
          </h2>

          <label className="eyebrow mb-1.5 block">Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="The Listener"
            className="field font-display !text-[17px]"
          />

          <label className="eyebrow mt-5 mb-2 block">Color</label>
          <div className="flex flex-wrap gap-2.5">
            {COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Color ${c}`}
                onClick={() => setForm((f) => ({ ...f, color: c }))}
                className={
                  'h-7 w-7 rounded-full transition ' +
                  (form.color === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-parchment' : 'hover:scale-110')
                }
                style={{ backgroundColor: c }}
              />
            ))}
          </div>

          <label className="eyebrow mt-5 mb-1.5 block">Voice</label>
          <div className="flex gap-2">
            <select
              value={form.voiceId}
              onChange={(e) => setForm((f) => ({ ...f, voiceId: e.target.value }))}
              className="field flex-1"
            >
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.accent} {v.gender === 'f' ? 'female' : 'male'}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                preview.toggle(form.voiceId, `Hi, I'm ${form.name.trim() || 'Parla'}. What's on your mind?`)
              }
              className="btn-quiet !rounded-[10px] !px-4"
            >
              <Icon
                name={preview.playing === form.voiceId ? 'pause' : 'play'}
                size={13}
                className={preview.loading === form.voiceId ? 'animate-pulse' : ''}
              />
              Preview
            </button>
          </div>
          {preview.error && <p className="mt-1.5 text-[12px] text-red-700">{preview.error}</p>}

          <label className="eyebrow mt-5 mb-1.5 block">Personality</label>
          <textarea
            value={form.systemPrompt}
            onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
            placeholder="Who is this companion? How do they talk, what do they care about? Remind them they're speaking out loud: short, natural sentences, no lists."
            rows={9}
            className="field font-display !text-[15px] !leading-relaxed"
          />

          <div className="mt-auto pt-6">
            <button onClick={() => void save()} disabled={!canSave} className="btn-primary font-display w-full !rounded-xl py-3 text-[18px]">
              {savedFlash ? 'Saved' : 'Save'}
            </button>
            {selected !== 'new' && !selected.isBuiltin && (
              <button
                onClick={() => void remove(selected)}
                className="mt-3 w-full text-center text-[13px] text-ink-soft hover:text-red-700"
              >
                Delete this persona
              </button>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
