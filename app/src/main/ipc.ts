// All ipcMain.handle registrations. The renderer sees these through the
// typed preload bridge (window.parla.*).

import { ipcMain } from 'electron'
import type { MemoryEntry, Persona, TurnMetrics, UsageDelta } from '@shared/types'
import { chatsRepo, memoryRepo, messagesRepo, personasRepo, settingsRepo } from './db/repos'
import { takeLaunchIntent } from './launch'
import { endSession, resolveLLMConfig, startSession, type StartOptions } from './sessions'
import { parseToken, sendToStudio, studioProjects, studioTest } from './studio'
import { ensureLocalModel, localStatus } from './local-llm'
import { chatUsage, openRouterKeyInfo, recordUsage, usageSummary } from './usage'
import type { VoiceServer } from './voice-server'

export function registerIpc(voiceServer: VoiceServer): void {
  ipcMain.handle('voice:status', () => voiceServer.current)
  ipcMain.handle('voice:restart', () => voiceServer.restart())

  ipcMain.handle('session:start', (e, personaId: string | null, opts?: StartOptions) =>
    startSession(
      voiceServer,
      personaId ?? null,
      (text) => {
        if (!e.sender.isDestroyed()) e.sender.send('session:progress', text)
      },
      opts ?? {}
    )
  )

  ipcMain.handle('launch:take', () => takeLaunchIntent())

  ipcMain.handle('studio:test', () => studioTest())
  ipcMain.handle('studio:projects', () => studioProjects())
  ipcMain.handle('studio:resend', (_e, chatId: string) => sendToStudio(chatId))

  // Short voice sample for the voice pickers (bytes → renderer plays a blob).
  ipcMain.handle('voice:preview', async (_e, voiceId: string, text?: string) => {
    const base = voiceServer.baseUrl
    if (!base) throw new Error('Voice engine is not running')
    const res = await fetch(`${base}/tts/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice_id: voiceId, text }),
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) throw new Error(`Voice preview failed (${res.status})`)
    return new Uint8Array(await res.arrayBuffer())
  })

  ipcMain.handle('local:status', () => localStatus())
  ipcMain.handle('local:load', async () => {
    const llm = resolveLLMConfig()
    if (llm.provider !== 'lmstudio') return
    await ensureLocalModel(llm.model, llm.base_url)
  })
  ipcMain.handle('session:end', (_e, chatId: string) => endSession(voiceServer, chatId))

  ipcMain.handle('chats:list', () => chatsRepo.list())
  ipcMain.handle('chats:get', (_e, id: string) => chatsRepo.get(id))
  ipcMain.handle('chats:delete', (_e, id: string) => chatsRepo.delete(id))
  ipcMain.handle('messages:list', (_e, chatId: string) => messagesRepo.listForChat(chatId))
  ipcMain.handle(
    'messages:add',
    (
      _e,
      input: {
        chatId: string
        role: 'user' | 'assistant'
        content: string
        interrupted?: boolean
        metrics?: TurnMetrics | null
      }
    ) => messagesRepo.add(input)
  )

  // Validates the *saved* provider config via the voice worker (key stays in main).
  ipcMain.handle('llm:check', async () => {
    const base = voiceServer.baseUrl
    if (!base) return { ok: false, detail: 'Voice engine is not running' }
    let llm
    try {
      llm = resolveLLMConfig()
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
    const res = await fetch(`${base}/llm/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(llm),
      signal: AbortSignal.timeout(10_000)
    })
    return (await res.json()) as { ok: boolean; detail: string }
  })

  ipcMain.handle('usage:add', (_e, chatId: string, delta: UsageDelta) =>
    recordUsage(chatId, 'conversation', delta)
  )
  ipcMain.handle('usage:chat', (_e, chatId: string) => chatUsage(chatId))
  ipcMain.handle('usage:summary', () => usageSummary())
  ipcMain.handle('usage:openrouterKey', () => openRouterKeyInfo())

  ipcMain.handle('personas:list', () => personasRepo.list())
  ipcMain.handle(
    'personas:create',
    (_e, input: { name: string; systemPrompt: string; voiceId: string; color: string }) =>
      personasRepo.create(input)
  )
  ipcMain.handle(
    'personas:update',
    (_e, id: string, patch: Partial<Pick<Persona, 'name' | 'systemPrompt' | 'voiceId' | 'color'>>) =>
      personasRepo.update(id, patch)
  )
  ipcMain.handle('personas:delete', (_e, id: string) => personasRepo.delete(id))

  ipcMain.handle('memory:list', () => memoryRepo.listAll())
  ipcMain.handle(
    'memory:update',
    (_e, id: string, patch: Partial<Pick<MemoryEntry, 'content' | 'importance' | 'status' | 'kind'>>) =>
      memoryRepo.update(id, patch)
  )
  ipcMain.handle('memory:delete', (_e, id: string) => memoryRepo.delete(id))

  ipcMain.handle('settings:all', () => {
    // Secrets never round-trip to the renderer — only their presence.
    const all = settingsRepo.all()
    for (const provider of ['openrouter', 'anthropic']) {
      all[`llm.${provider}.hasKey`] = Boolean(all[`llm.${provider}.apiKey`])
      delete all[`llm.${provider}.apiKey`]
    }
    all['studio.hasToken'] = Boolean(all['studio.token'])
    delete all['studio.token']
    return all
  })
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) =>
    settingsRepo.set(key, key === 'studio.token' ? parseToken(String(value ?? '')) : value)
  )
}
