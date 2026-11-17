import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'path'
import { closeDb } from './db'
import { registerIpc } from './ipc'
import { ensureLocalModel, unloadParlaModels } from './local-llm'
import { resolveLLMConfig, retryPendingExtractions } from './sessions'
import { VoiceServer } from './voice-server'

const voiceServer = new VoiceServer()

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0a12',
    title: 'Parla',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning') {
      console.log(`[renderer:${details.level}]`, details.message)
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const autostart = process.env.PARLA_AUTOSTART ? '?autostart' : ''
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + autostart)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      search: autostart ? 'autostart' : undefined
    })
  }
  return win
}

app.whenReady().then(() => {
  // Mic access: grant media requests from our own renderer.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  registerIpc(voiceServer)

  const win = createWindow()
  let retriedExtractions = false
  voiceServer.onStatus((status) => {
    if (!win.isDestroyed()) win.webContents.send('voice:status-changed', status)
    if (status.state === 'ready' && !retriedExtractions) {
      retriedExtractions = true
      retryPendingExtractions(voiceServer)
    }
  })
  voiceServer.start()
  preloadLocalModel()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

/** If the local provider is selected, start loading it now, not at "Start talking". */
function preloadLocalModel(): void {
  try {
    const llm = resolveLLMConfig()
    if (llm.provider === 'lmstudio') {
      ensureLocalModel(llm.model, llm.base_url).catch((e) =>
        console.warn('local model preload failed', e)
      )
    }
  } catch {
    // misconfigured provider: surfaced at session start instead
  }
}

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  Promise.allSettled([voiceServer.stop(), unloadParlaModels()])
    .finally(() => {
      closeDb()
      app.quit()
    })
})

app.on('window-all-closed', () => {
  app.quit()
})
