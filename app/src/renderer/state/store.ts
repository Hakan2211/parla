import { create } from 'zustand'
import type { ServerMessage } from '@shared/events'
import type {
  Chat,
  Message,
  Persona,
  TurnMetrics,
  UsageTotals,
  VoiceServerStatus
} from '@shared/types'
import { toTurnMetrics } from '@shared/events'
import { VoiceSession } from '@/voice/client'

export type SphereState = 'idle' | 'listening' | 'thinking' | 'speaking'
export type View =
  | { kind: 'session' }
  | { kind: 'chat'; chatId: string }
  | { kind: 'settings' }
  | { kind: 'personas' }
  | { kind: 'memory' }

export interface LiveMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: number
  interrupted?: boolean
  pending?: boolean
}

interface ParlaState {
  voiceStatus: VoiceServerStatus
  setVoiceStatus: (s: VoiceServerStatus) => void

  view: View
  setView: (v: View) => void

  chats: Chat[]
  refreshChats: () => Promise<void>
  deleteChat: (id: string) => Promise<void>
  chatMessages: Message[]
  openChat: (chatId: string) => Promise<void>

  personas: Persona[]
  refreshPersonas: () => Promise<void>
  activePersonaId: string | null
  setActivePersonaId: (id: string | null) => void

  connection: 'disconnected' | 'connecting' | 'connected'
  activeChatId: string | null
  botSpeaking: boolean
  userSpeaking: boolean
  awaitingReply: boolean
  liveMessages: LiveMessage[]
  turnMetrics: TurnMetrics[]
  /** Running usage of the live session, priced by main (single source of truth). */
  sessionUsage: UsageTotals | null
  micLevel: number
  botLevel: number
  sessionError: string | null
  sessionWarning: number | null
  sessionNotice: string | null
  /** Pre-connect progress, e.g. "Loading gemma… onto the GPU". */
  sessionProgress: string

  startSession: () => Promise<void>
  endSession: () => Promise<void>
}

const voiceSession = new VoiceSession()
let liveAssistantId: string | null = null
let messageCounter = 0

function nextId(): string {
  return `live-${++messageCounter}`
}

export const useParlaStore = create<ParlaState>((set, get) => ({
  voiceStatus: { state: 'starting', port: null },
  setVoiceStatus: (voiceStatus) => set({ voiceStatus }),

  view: { kind: 'session' },
  setView: (view) => set({ view }),

  chats: [],
  refreshChats: async () => set({ chats: await window.parla.chats.list() }),
  deleteChat: async (id) => {
    await window.parla.chats.delete(id)
    const { view } = get()
    if (view.kind === 'chat' && view.chatId === id) set({ view: { kind: 'session' } })
    await get().refreshChats()
  },
  chatMessages: [],
  openChat: async (chatId) => {
    set({ view: { kind: 'chat', chatId }, chatMessages: [] })
    set({ chatMessages: await window.parla.messages.list(chatId) })
  },

  personas: [],
  refreshPersonas: async () => {
    const personas = await window.parla.personas.list()
    set((s) => ({
      personas,
      activePersonaId: s.activePersonaId ?? personas[0]?.id ?? null
    }))
  },
  activePersonaId: null,
  setActivePersonaId: (activePersonaId) => set({ activePersonaId }),

  connection: 'disconnected',
  activeChatId: null,
  botSpeaking: false,
  userSpeaking: false,
  awaitingReply: false,
  liveMessages: [],
  turnMetrics: [],
  sessionUsage: null,
  micLevel: 0,
  botLevel: 0,
  sessionError: null,
  sessionWarning: null,
  sessionNotice: null,
  sessionProgress: '',

  startSession: async () => {
    if (get().connection !== 'disconnected') return
    set({
      view: { kind: 'session' },
      sessionError: null,
      sessionWarning: null,
      sessionNotice: null,
      liveMessages: [],
      turnMetrics: [],
      sessionUsage: null,
      connection: 'connecting'
    })
    try {
      const { chatId, wsUrl } = await window.parla.session.start(get().activePersonaId)
      set({ activeChatId: chatId })
      await voiceSession.connect(wsUrl, {
        onConnectionState: (state) => {
          set({ connection: state === 'disconnected' ? 'disconnected' : state })
          if (state === 'disconnected') {
            set({ botSpeaking: false, userSpeaking: false, micLevel: 0, botLevel: 0 })
            void get().endSession()
          }
        },
        onBotSpeaking: (botSpeaking) =>
          set(botSpeaking ? { botSpeaking, awaitingReply: false } : { botSpeaking }),
        onUserSpeaking: (userSpeaking) =>
          set(userSpeaking ? { userSpeaking, awaitingReply: false } : { userSpeaking, awaitingReply: true }),
        onBotText: (text) => {
          set((s) => {
            const messages = [...s.liveMessages]
            const last = messages[messages.length - 1]
            if (liveAssistantId && last?.id === liveAssistantId) {
              messages[messages.length - 1] = { ...last, text: last.text + text }
            } else {
              liveAssistantId = nextId()
              messages.push({
                id: liveAssistantId,
                role: 'assistant',
                text,
                at: Date.now(),
                pending: true
              })
            }
            return { liveMessages: messages }
          })
        },
        onUserTranscript: () => {
          // authoritative text arrives via user.final server message
        },
        onServerMessage: (message: ServerMessage) => {
          const chatId = get().activeChatId
          if (message.type === 'user.final') {
            liveAssistantId = null
            set((s) => ({
              liveMessages: [
                ...s.liveMessages,
                { id: nextId(), role: 'user', text: message.text, at: Date.now() }
              ]
            }))
            if (chatId) {
              void window.parla.messages.add({ chatId, role: 'user', content: message.text })
            }
          } else if (message.type === 'assistant.final') {
            set((s) => {
              const messages = [...s.liveMessages]
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'assistant' && messages[i].pending) {
                  messages[i] = {
                    ...messages[i],
                    text: message.text,
                    interrupted: message.interrupted,
                    pending: false
                  }
                  break
                }
              }
              return { liveMessages: messages }
            })
            liveAssistantId = null
            if (chatId) {
              const metrics = get().turnMetrics
              void window.parla.messages.add({
                chatId,
                role: 'assistant',
                content: message.text,
                interrupted: message.interrupted,
                metrics: metrics[metrics.length - 1] ?? null
              })
            }
          } else if (message.type === 'metrics.turn') {
            set((s) => ({ turnMetrics: [...s.turnMetrics, toTurnMetrics(message)] }))
          } else if (message.type === 'usage.delta') {
            if (chatId) {
              const { type: _type, ...delta } = message
              void window.parla.usage
                .add(chatId, delta)
                .then(() => window.parla.usage.chat(chatId))
                .then((sessionUsage) => {
                  if (get().activeChatId === chatId) set({ sessionUsage })
                })
            }
          } else if (message.type === 'session.warning') {
            set({ sessionWarning: message.remaining_s })
          } else if (message.type === 'session.notice') {
            set({ sessionNotice: message.text })
          } else if (message.type === 'session.end') {
            void get().endSession()
          }
        },
        onLevels: (mic, bot) => set({ micLevel: mic, botLevel: bot }),
        onError: (message) => set({ sessionError: message })
      })
    } catch (e) {
      set({
        connection: 'disconnected',
        sessionProgress: '',
        sessionError: (e instanceof Error ? e.message : String(e)).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          ''
        )
      })
      const chatId = get().activeChatId
      if (chatId) {
        set({ activeChatId: null })
        void window.parla.session.end(chatId).then(() => get().refreshChats())
      }
    }
  },

  endSession: async () => {
    const chatId = get().activeChatId
    await voiceSession.disconnect()
    set({ connection: 'disconnected', botSpeaking: false, userSpeaking: false })
    if (chatId) {
      set({ activeChatId: null })
      await window.parla.session.end(chatId)
      await get().refreshChats()
    }
  }
}))

export function selectSphereState(s: ParlaState): SphereState {
  if (s.connection !== 'connected') return 'idle'
  if (s.botSpeaking) return 'speaking'
  if (s.awaitingReply) return 'thinking'
  return 'listening'
}

// Wire IPC push updates into the store once at module load.
if (typeof window !== 'undefined' && window.parla) {
  window.parla.voice.status().then((s) => useParlaStore.getState().setVoiceStatus(s))
  window.parla.voice.onStatusChanged((s) => useParlaStore.getState().setVoiceStatus(s))
  window.parla.session.onProgress((sessionProgress) => useParlaStore.setState({ sessionProgress }))
  void useParlaStore.getState().refreshChats()
  void useParlaStore.getState().refreshPersonas()
}
