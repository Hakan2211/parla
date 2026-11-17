// Context brief: what Parla remembers, templated into the system prompt at
// session start. Pure selection + templating — no LLM call (docs Phase 2).

import { chatsRepo, memoryRepo, personasRepo } from './db/repos'

const LIMITS = { fact: 15, person: 8, thread: 6, commitment: 6 }

function relativeDay(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} week(s) ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function buildContextBrief(): string {
  const entries = memoryRepo.listActive()
  const sections: string[] = []

  const byKind = (kind: keyof typeof LIMITS, title: string): void => {
    const items = entries.filter((e) => e.kind === kind).slice(0, LIMITS[kind])
    if (items.length > 0) {
      sections.push(`${title}:\n${items.map((e) => `- ${e.content}`).join('\n')}`)
    }
  }

  byKind('fact', 'Facts about the user')
  byKind('person', 'People in their life')
  byKind('thread', 'Open threads')
  byKind('commitment', 'Commitments')

  const recent = chatsRepo
    .list()
    .filter((c) => c.summary)
    .slice(0, 5)
  if (recent.length > 0) {
    const lines = recent.map((c) => {
      const persona = c.personaId ? personasRepo.get(c.personaId)?.name : null
      return `- ${relativeDay(c.startedAt)}${persona ? ` (with ${persona})` : ''}: ${c.summary}`
    })
    sections.push(`Recent conversations:\n${lines.join('\n')}`)
  }

  if (sections.length === 0) return ''
  return `## What you remember about the user\n${sections.join('\n\n')}`
}
