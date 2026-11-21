// Session orchestration: assemble config from persona + settings, create the
// chat row, POST /sessions to the voice server, hand ws_url to the renderer.
// On end: close the chat row and kick off memory extraction (M6).

import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import type { LLMProvider, MemoryKind, SessionStartResult, UsageDelta } from '@shared/types'
import { buildContextBrief } from './brief'
import { chatsRepo, memoryRepo, messagesRepo, personasRepo, settingsRepo } from './db/repos'
import { ensureLocalModel, isLoading, LMSTUDIO_DEFAULT_URL, LOCAL_DEFAULT_MODEL } from './local-llm'
import { refreshOpenRouterPrices } from './pricing'
import { recordUsage } from './usage'
import {
  contextSection,
  PRODUCER_ID,
  projectContext,
  retryPendingStudio,
  sendToStudio,
  setStudioRuntime,
  studioReady,
  wantsStudio
} from './studio'
import type { VoiceServer } from './voice-server'

const DEFAULT_SYSTEM_PROMPT = `You are Parla, a warm, curious voice companion.
You are having a spoken conversation: keep responses short and natural —
one to three sentences unless asked to elaborate. Never use markdown,
lists, or emoji; you are speaking out loud.`

const DEFAULT_GREETING = 'Hey! Good to hear you. What have you been up to?'

export interface LLMSessionConfig {
  provider: LLMProvider
  model: string
  api_key?: string
  base_url?: string
  effort?: 'low' | 'medium' | 'high'
}

/** Default direct-API model. Changeable in Settings (Sonnet/Haiku are faster and cheaper). */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5'

/** Resolve LLM config from settings; env vars override for dev. */
export function resolveLLMConfig(): LLMSessionConfig {
  // Claude default: works with the Claude Code login, no key needed.
  // OpenRouter (faster first token) once the user adds a key in Settings.
  const provider = (process.env.PARLA_LLM_PROVIDER ||
    settingsRepo.get('llm.provider', 'claude')) as LLMProvider

  if (provider === 'openrouter') {
    const apiKey =
      process.env.OPENROUTER_API_KEY || settingsRepo.get('llm.openrouter.apiKey', '')
    if (!apiKey) {
      throw new Error(
        'No OpenRouter API key configured. Add one in Settings (or set OPENROUTER_API_KEY).'
      )
    }
    return {
      provider,
      model:
        process.env.PARLA_LLM_MODEL ||
        settingsRepo.get('llm.openrouter.model', 'google/gemini-2.5-flash'),
      api_key: apiKey,
      base_url: process.env.PARLA_LLM_BASE_URL || undefined
    }
  }
  if (provider === 'anthropic') {
    const apiKey =
      process.env.ANTHROPIC_API_KEY || settingsRepo.get('llm.anthropic.apiKey', '')
    if (!apiKey) {
      throw new Error(
        'No Anthropic API key configured. Add one in Settings (or set ANTHROPIC_API_KEY).'
      )
    }
    return {
      provider,
      model:
        process.env.PARLA_LLM_MODEL ||
        settingsRepo.get('llm.anthropic.model', ANTHROPIC_DEFAULT_MODEL),
      api_key: apiKey,
      effort: settingsRepo.get<'low' | 'medium' | 'high'>('llm.anthropic.effort', 'low')
    }
  }
  if (provider === 'lmstudio') {
    return {
      provider,
      model:
        process.env.PARLA_LLM_MODEL ||
        settingsRepo.get('llm.lmstudio.model', '') ||
        LOCAL_DEFAULT_MODEL,
      base_url:
        process.env.PARLA_LLM_BASE_URL ||
        settingsRepo.get('llm.lmstudio.baseUrl', LMSTUDIO_DEFAULT_URL)
    }
  }
  return {
    provider: 'claude',
    model: process.env.PARLA_LLM_MODEL || settingsRepo.get('llm.claude.model', 'sonnet')
  }
}

/** Fail fast with a friendly message instead of a dead session. */
async function preflight(
  llm: LLMSessionConfig,
  onProgress: (text: string) => void
): Promise<void> {
  if (llm.provider === 'lmstudio') {
    // Starts LM Studio's server and loads the model if needed; if a
    // background pre-load is already running this just waits for it.
    if (isLoading(llm.model)) {
      onProgress(`Loading ${llm.model} onto the GPU — 1–2 minutes, first time only…`)
    } else {
      onProgress(`Checking local model ${llm.model}…`)
    }
    const slow = setTimeout(
      () => onProgress(`Loading ${llm.model} onto the GPU — 1–2 minutes, first time only…`),
      2500
    )
    try {
      await ensureLocalModel(llm.model, llm.base_url)
    } catch (e) {
      throw new Error(
        `Local model ${llm.model} could not be loaded: ${e instanceof Error ? e.message : String(e)}`
      )
    } finally {
      clearTimeout(slow)
      onProgress('')
    }
  }
}

export interface StartOptions {
  /** A Studio project to talk about (`--studio-project`, or the start screen's picker). */
  studioProjectId?: string | null
}

export async function startSession(
  voiceServer: VoiceServer,
  personaId: string | null,
  onProgress: (text: string) => void = () => {},
  opts: StartOptions = {}
): Promise<SessionStartResult> {
  const base = voiceServer.baseUrl
  if (!base) throw new Error('voice server is not running')

  const llm = resolveLLMConfig()
  await preflight(llm, onProgress)
  if (llm.provider === 'openrouter') void refreshOpenRouterPrices()
  const persona = personaId ? personasRepo.get(personaId) : null
  const systemPrompt = persona?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
  const brief = buildContextBrief()

  // Studio: context before the session, never during it (docs/07-studio-bridge.md).
  let studioProjectId = opts.studioProjectId || null
  let studio = ''
  let notice: string | undefined
  let greeting = DEFAULT_GREETING
  if (studioProjectId) {
    if (!studioReady()) {
      notice = 'Studio is off in Settings: talking without the project.'
      studioProjectId = null
    } else {
      onProgress('Fetching the project from Studio…')
      try {
        const ctx = await projectContext(studioProjectId)
        studio = contextSection(ctx)
        greeting = `Let's work on “${ctx.title}”. Where do you want to start?`
      } catch (e) {
        // Still a Studio conversation: its proposals go to the Inbox later.
        notice = `${e instanceof Error ? e.message : String(e)} Talking without the project's context.`
      } finally {
        onProgress('')
      }
    }
  } else if (persona?.id === PRODUCER_ID) {
    greeting = 'What are you making next?'
  }
  const prompt = [systemPrompt, studio, brief].filter(Boolean).join('\n\n')

  const chatId = randomUUID()
  const res = await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      system_prompt: prompt,
      greeting,
      voice: { engine: settingsRepo.get('tts.engine', 'kokoro'), voice_id: persona?.voiceId ?? 'af_heart' },
      llm,
      stt: { engine: 'sherpa' },
      limits: { max_minutes: 60 }
    }),
    signal: AbortSignal.timeout(5000)
  })
  if (!res.ok) throw new Error(`voice server rejected session: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { session_id: string; ws_url: string }

  chatsRepo.create({
    id: chatId,
    personaId: persona?.id ?? null,
    provider: llm.provider,
    model: llm.model,
    studioProjectId
  })
  if (wantsStudio(persona?.id ?? null, studioProjectId)) chatsRepo.setStudio(chatId, 'pending')
  return { chatId, sessionId: body.session_id, wsUrl: body.ws_url, notice }
}

export async function endSession(voiceServer: VoiceServer, chatId: string): Promise<void> {
  const chat = chatsRepo.get(chatId)
  if (!chat || chat.endedAt) return
  chatsRepo.end(chatId)
  // Fire-and-forget: extraction must never block the UI. Studio goes second,
  // so its proposals carry the conversation's title.
  void extractChat(voiceServer, chatId)
    .catch(() => {})
    .then(() => sendToStudio(chatId))
    .catch(() => {})
}

interface ExtractResponse {
  title: string
  summary: string
  new_entries: { kind: MemoryKind; content: string; importance: number }[]
  updates: { id: string; content?: string | null; status?: 'active' | 'archived' | null }[]
  usage?: UsageDelta
}

/** Tell renderers a chat's title/summary changed (extraction finishes after the session ends). */
function notifyChatsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('chats:changed')
  }
}

export async function extractChat(voiceServer: VoiceServer, chatId: string): Promise<void> {
  const base = voiceServer.baseUrl
  const chat = chatsRepo.get(chatId)
  if (!base || !chat) return

  if (messagesRepo.countForChat(chatId, 'user') < 2) {
    chatsRepo.setExtraction(chatId, 'skipped')
    return
  }

  try {
    const persona = chat.personaId ? personasRepo.get(chat.personaId) : null
    const llm = resolveLLMConfig()
    if (llm.provider === 'openrouter') await refreshOpenRouterPrices()
    const res = await fetch(`${base}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: messagesRepo
          .listForChat(chatId)
          .map((m) => ({ role: m.role, content: m.content })),
        persona_name: persona?.name ?? 'Parla',
        existing_memory: memoryRepo
          .listActive()
          .map((e) => ({ id: e.id, kind: e.kind, content: e.content })),
        llm
      }),
      signal: AbortSignal.timeout(60_000)
    })
    if (!res.ok) throw new Error(`extract failed: ${res.status}`)
    const result = (await res.json()) as ExtractResponse
    if (result.usage) recordUsage(chatId, 'extraction', result.usage, llm.provider)

    for (const entry of result.new_entries) {
      memoryRepo.add({ ...entry, sourceChatId: chatId })
    }
    for (const update of result.updates) {
      memoryRepo.update(update.id, {
        content: update.content ?? undefined,
        status: update.status ?? undefined
      })
    }
    chatsRepo.setExtraction(chatId, 'done', result.title, result.summary)
  } catch (e) {
    console.error('extraction failed for chat', chatId, e)
    chatsRepo.setExtraction(chatId, 'failed')
  } finally {
    notifyChatsChanged()
  }
}

/** Retry chats whose extraction failed (or never ran) — called once at launch. */
export function retryPendingExtractions(voiceServer: VoiceServer): void {
  const memory = chatsRepo.listPendingExtraction().map((chat) => extractChat(voiceServer, chat.id))
  // Then whatever couldn't reach Studio before (Studio closed, voice worker down).
  void Promise.allSettled(memory).then(() => retryPendingStudio())
}

/** Studio sends need the voice worker (extraction) and the LLM config; wired once at startup. */
export function wireStudio(voiceServer: VoiceServer): void {
  setStudioRuntime({ voiceServer, resolveLLM: resolveLLMConfig })
}
