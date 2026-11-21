// Studio bridge (docs/07-studio-bridge.md). Studio (D:\Studio) is the
// research → brief → script app; it serves MCP on 127.0.0.1:47825 with a
// bearer token. Parla touches it only before a session (project_context →
// system prompt) and after one (extraction → propose_from_session). Nothing
// here runs during the live conversation, and with Studio closed every call
// fails fast and Parla carries on as before.

import { BrowserWindow } from 'electron'
import type { StudioProject, UsageDelta } from '@shared/types'
import { chatsRepo, messagesRepo, personasRepo, settingsRepo } from './db/repos'
import { recordUsage } from './usage'
import type { LLMSessionConfig } from './sessions'
import type { VoiceServer } from './voice-server'

export const STUDIO_DEFAULT_URL = 'http://127.0.0.1:47825/mcp'
export const PRODUCER_ID = 'builtin-producer'
const PROTOCOL_VERSION = '2025-06-18'

interface StudioConfig {
  enabled: boolean
  url: string
  token: string
}

export function studioConfig(): StudioConfig {
  return {
    enabled: settingsRepo.get('studio.enabled', true),
    url: settingsRepo.get('studio.url', '') || STUDIO_DEFAULT_URL,
    token: settingsRepo.get('studio.token', '')
  }
}

/** On, with a token: the only state in which Parla calls Studio at all. */
export function studioReady(): boolean {
  const c = studioConfig()
  return c.enabled && c.token !== ''
}

/**
 * The token from whatever was pasted: the token itself, "Bearer …", Studio's
 * `claude mcp add … --header "Authorization: Bearer …"` command, or its
 * mcpServers JSON block.
 */
export function parseToken(input: string): string {
  const s = input.trim()
  const bearer = s.match(/Bearer\s+([A-Za-z0-9._~+/=-]+)/)
  if (bearer) return bearer[1]
  return s.replace(/^["']|["']$/g, '')
}

let rpcId = 0

/** One MCP tools/call; returns the tool's JSON result. Throws with a readable message. */
export async function callTool<T>(
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 4000,
  cfg: StudioConfig = studioConfig()
): Promise<T> {
  if (!cfg.token) throw new Error('No Studio token. Paste it in Settings › Studio.')
  let res: Response
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${cfg.token}`,
        'MCP-Protocol-Version': PROTOCOL_VERSION
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'tools/call',
        params: { name, arguments: args }
      }),
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch {
    throw new Error("Studio isn't running (or isn't reachable).")
  }
  if (res.status === 401) throw new Error('Studio rejected the token. Copy it from Studio again.')
  if (!res.ok) throw new Error(`Studio answered ${res.status}.`)
  const body = (await res.json()) as {
    result?: { content?: { type: string; text: string }[]; isError?: boolean }
    error?: { message: string }
  }
  if (body.error) throw new Error(`Studio: ${body.error.message}`)
  const text = body.result?.content?.find((c) => c.type === 'text')?.text ?? ''
  if (body.result?.isError) throw new Error(`Studio: ${text.replace(/^Error:\s*/, '')}`)
  return JSON.parse(text) as T
}

export async function studioTest(): Promise<{ ok: boolean; detail: string }> {
  const cfg = studioConfig()
  if (!cfg.token) return { ok: false, detail: 'Paste the token from Studio first.' }
  try {
    const r = await callTool<{ projects: unknown[] }>('list_projects', {}, 4000, cfg)
    const n = r.projects?.length ?? 0
    // Studio is back: anything that couldn't be sent earlier goes now.
    retryPendingStudio()
    return { ok: true, detail: `Connected · ${n} project${n === 1 ? '' : 's'}` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** Projects for the session picker: work in progress first, then ideas. Empty if Studio is off. */
export async function studioProjects(): Promise<StudioProject[]> {
  if (!studioReady()) return []
  const r = await callTool<{ projects: StudioProject[] }>('list_projects', {})
  const rank = (s: string): number => (s === 'idea' ? 2 : s === 'published' ? 3 : 1)
  return r.projects
    .map((p) => ({ id: p.id, title: p.title, status: p.status, format: p.format }))
    .sort((a, b) => rank(a.status) - rank(b.status))
}

export interface ProjectContext {
  project_id: string
  title: string
  angle: string
  audience: string
  thesis: string
  key_points: string[]
  open_questions: string[]
  prompt: string
}

export async function projectContext(projectId: string, timeoutMs = 3000): Promise<ProjectContext> {
  return callTool<ProjectContext>('project_context', { project_id: projectId }, timeoutMs)
}

/** The system prompt section for a session about a Studio project. */
export function contextSection(ctx: ProjectContext): string {
  return (
    `## The piece you are talking about\n` +
    `This conversation is about a project in the user's content workspace (Studio). ` +
    `Use it to ask better questions; don't read it out.\n\n${ctx.prompt}`
  )
}

// ---------- after a session ----------

/** Whether a chat's proposals should go to Studio, decided when it starts. */
export function wantsStudio(personaId: string | null, studioProjectId: string | null): boolean {
  return studioReady() && (studioProjectId !== null || personaId === PRODUCER_ID)
}

interface StudioExtractResponse {
  items: {
    kind: string
    section: string | null
    title: string | null
    body: string
    at: string
    excerpt: string
  }[]
  dropped: number
  usage?: UsageDelta
}

function notifyChatsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('chats:changed')
  }
}

const sending = new Set<string>()

/**
 * Extract Studio material from an ended chat and send it to Studio's Inbox.
 * Safe to call again: Studio skips items it already has from this chat.
 */
export async function sendToStudio(chatId: string): Promise<void> {
  const chat = chatsRepo.get(chatId)
  const base = runtime?.voiceServer.baseUrl
  if (!chat || !chat.endedAt || chat.studioStatus === 'none' || sending.has(chatId)) return
  if (!studioReady()) {
    chatsRepo.setStudio(chatId, 'failed', undefined, 'Studio is off or has no token in Settings.')
    notifyChatsChanged()
    return
  }
  if (!runtime || !base) return // voice worker not up yet; retried when it is
  if (messagesRepo.countForChat(chatId, 'user') < 2) {
    chatsRepo.setStudio(chatId, 'skipped', 0, 'Too short to propose anything.')
    notifyChatsChanged()
    return
  }

  sending.add(chatId)
  chatsRepo.setStudio(chatId, 'pending', undefined, null)
  notifyChatsChanged()
  try {
    // The project as it is now, so the extraction skips what it already has.
    // Studio must be reachable to receive the proposals anyway.
    const ctx = chat.studioProjectId ? await projectContext(chat.studioProjectId, 5000) : null

    const llm = runtime.resolveLLM()
    const messages = messagesRepo.listForChat(chatId)
    const res = await fetch(`${base}/extract/studio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: messages.map((m) => ({
          role: m.role,
          content: m.content,
          at_s: Math.max((m.createdAt - chat.startedAt) / 1000, 0)
        })),
        project: ctx && {
          title: ctx.title,
          angle: ctx.angle,
          audience: ctx.audience,
          thesis: ctx.thesis,
          key_points: ctx.key_points,
          open_questions: ctx.open_questions
        },
        llm
      }),
      signal: AbortSignal.timeout(120_000)
    })
    if (!res.ok) throw new Error(`Extraction failed (${res.status}).`)
    const out = (await res.json()) as StudioExtractResponse
    if (out.usage) recordUsage(chatId, 'extraction', out.usage, llm.provider)

    if (out.items.length === 0) {
      chatsRepo.setStudio(chatId, 'done', 0, 'Nothing to propose from this conversation.')
      return
    }
    const persona = chat.personaId ? personasRepo.get(chat.personaId) : null
    const fresh = chatsRepo.get(chatId)
    const r = await callTool<{ proposed: number; skipped: number }>(
      'propose_from_session',
      {
        chat_id: chatId,
        chat_title: fresh?.title ?? `Conversation with ${persona?.name ?? 'Parla'}`,
        ...(chat.studioProjectId ? { project_id: chat.studioProjectId } : {}),
        items: out.items.map((i) => ({
          kind: i.kind,
          ...(i.section ? { section: i.section } : {}),
          ...(i.title ? { title: i.title } : {}),
          body: i.body,
          at: i.at,
          excerpt: i.excerpt
        }))
      },
      15_000
    )
    chatsRepo.setStudio(chatId, 'done', (chat.studioSent ?? 0) + r.proposed, null)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.warn('studio send failed for chat', chatId, detail)
    chatsRepo.setStudio(chatId, 'failed', undefined, detail)
  } finally {
    sending.delete(chatId)
    notifyChatsChanged()
  }
}

interface Runtime {
  voiceServer: VoiceServer
  resolveLLM: () => LLMSessionConfig
}
let runtime: Runtime | null = null

/** Wired once at startup (sessions.ts owns the voice server and LLM config). */
export function setStudioRuntime(r: Runtime): void {
  runtime = r
}

/** Send what couldn't be sent before: at launch, and when Settings › Studio › Test succeeds. */
export function retryPendingStudio(): void {
  for (const chat of chatsRepo.listPendingStudio()) void sendToStudio(chat.id)
}
