import { contextBridge, ipcRenderer } from 'electron'
import type {
  Chat,
  MemoryEntry,
  Message,
  Persona,
  SessionStartResult,
  LocalStatus,
  OpenRouterKeyInfo,
  TurnMetrics,
  UsageDelta,
  UsageSummary,
  UsageTotals,
  VoiceServerStatus
} from '@shared/types'

const api = {
  voice: {
    status: (): Promise<VoiceServerStatus> => ipcRenderer.invoke('voice:status'),
    restart: (): Promise<void> => ipcRenderer.invoke('voice:restart'),
    preview: (voiceId: string, text?: string): Promise<Uint8Array> =>
      ipcRenderer.invoke('voice:preview', voiceId, text),
    onStatusChanged: (fn: (s: VoiceServerStatus) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, s: VoiceServerStatus): void => fn(s)
      ipcRenderer.on('voice:status-changed', listener)
      return () => ipcRenderer.removeListener('voice:status-changed', listener)
    }
  },
  session: {
    start: (personaId: string | null): Promise<SessionStartResult> =>
      ipcRenderer.invoke('session:start', personaId),
    end: (chatId: string): Promise<void> => ipcRenderer.invoke('session:end', chatId),
    onProgress: (fn: (text: string) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, text: string): void => fn(text)
      ipcRenderer.on('session:progress', listener)
      return () => ipcRenderer.removeListener('session:progress', listener)
    }
  },
  local: {
    status: (): Promise<LocalStatus> => ipcRenderer.invoke('local:status'),
    load: (): Promise<void> => ipcRenderer.invoke('local:load')
  },
  chats: {
    list: (): Promise<Chat[]> => ipcRenderer.invoke('chats:list'),
    get: (id: string): Promise<Chat | null> => ipcRenderer.invoke('chats:get', id),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('chats:delete', id),
    onChanged: (fn: () => void): (() => void) => {
      const listener = (): void => fn()
      ipcRenderer.on('chats:changed', listener)
      return () => ipcRenderer.removeListener('chats:changed', listener)
    }
  },
  messages: {
    list: (chatId: string): Promise<Message[]> => ipcRenderer.invoke('messages:list', chatId),
    add: (input: {
      chatId: string
      role: 'user' | 'assistant'
      content: string
      interrupted?: boolean
      metrics?: TurnMetrics | null
    }): Promise<Message> => ipcRenderer.invoke('messages:add', input)
  },
  llm: {
    check: (): Promise<{ ok: boolean; detail: string }> => ipcRenderer.invoke('llm:check')
  },
  usage: {
    add: (chatId: string, delta: UsageDelta): Promise<void> =>
      ipcRenderer.invoke('usage:add', chatId, delta),
    chat: (chatId: string): Promise<UsageTotals> => ipcRenderer.invoke('usage:chat', chatId),
    summary: (): Promise<UsageSummary> => ipcRenderer.invoke('usage:summary'),
    openrouterKey: (): Promise<OpenRouterKeyInfo | null> =>
      ipcRenderer.invoke('usage:openrouterKey')
  },
  personas: {
    list: (): Promise<Persona[]> => ipcRenderer.invoke('personas:list'),
    create: (input: {
      name: string
      systemPrompt: string
      voiceId: string
      color: string
    }): Promise<Persona> => ipcRenderer.invoke('personas:create', input),
    update: (
      id: string,
      patch: Partial<Pick<Persona, 'name' | 'systemPrompt' | 'voiceId' | 'color'>>
    ): Promise<Persona | null> => ipcRenderer.invoke('personas:update', id, patch),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('personas:delete', id)
  },
  memory: {
    list: (): Promise<MemoryEntry[]> => ipcRenderer.invoke('memory:list'),
    update: (
      id: string,
      patch: Partial<Pick<MemoryEntry, 'content' | 'importance' | 'status' | 'kind'>>
    ): Promise<void> => ipcRenderer.invoke('memory:update', id, patch),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('memory:delete', id)
  },
  settings: {
    all: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('settings:all'),
    set: (key: string, value: unknown): Promise<void> =>
      ipcRenderer.invoke('settings:set', key, value)
  }
}

export type ParlaApi = typeof api

contextBridge.exposeInMainWorld('parla', api)
