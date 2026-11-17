// Manages the Python voice server: find-or-spawn, health polling, shutdown.
//
// Strategy on startup:
//   1. Probe ports 8790-8799 for an existing healthy parla-voice -> adopt it.
//   2. Otherwise spawn `uv run parla-voice --port <first free port>`.
// On quit: POST /shutdown, then kill the process tree if it lingers.

import { ChildProcess, spawn } from 'child_process'
import { app } from 'electron'
import { createWriteStream, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import type { VoiceServerStatus } from '@shared/types'

const PORT_RANGE = Array.from({ length: 10 }, (_, i) => 8790 + i)
const BOOT_TIMEOUT_MS = 90_000
const POLL_INTERVAL_MS = 500

export class VoiceServer {
  private child: ChildProcess | null = null
  private adopted = false
  private status: VoiceServerStatus = { state: 'starting', port: null }
  private listeners = new Set<(s: VoiceServerStatus) => void>()

  get current(): VoiceServerStatus {
    return this.status
  }

  get baseUrl(): string | null {
    return this.status.port ? `http://127.0.0.1:${this.status.port}` : null
  }

  onStatus(fn: (s: VoiceServerStatus) => void): () => void {
    this.listeners.add(fn)
    fn(this.status)
    return () => this.listeners.delete(fn)
  }

  private setStatus(next: VoiceServerStatus): void {
    this.status = next
    for (const fn of this.listeners) fn(next)
  }

  private async health(port: number, timeoutMs = 1500): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!res.ok) return null
      const body = (await res.json()) as Record<string, unknown>
      // Only adopt servers that are actually parla-voice.
      return typeof body.version === 'string' && 'models' in body ? body : null
    } catch {
      return null
    }
  }

  private voiceProjectDir(): string {
    // app/ and voice/ are siblings in the repo; packaged builds ship voice/ in resources.
    return app.isPackaged
      ? join(process.resourcesPath, 'voice')
      : resolve(app.getAppPath(), '..', 'voice')
  }

  async start(): Promise<void> {
    this.setStatus({ state: 'starting', port: null, detail: 'looking for voice server' })

    for (const port of PORT_RANGE) {
      if (await this.health(port)) {
        this.adopted = true
        await this.waitForModels(port)
        return
      }
    }

    const port = PORT_RANGE[0]
    const logDir = join(app.getPath('userData'), 'logs')
    mkdirSync(logDir, { recursive: true })
    const log = createWriteStream(join(logDir, 'voice-server.log'), { flags: 'a' })
    log.write(`\n--- spawn ${new Date().toISOString()} ---\n`)

    this.setStatus({ state: 'starting', port, detail: 'starting voice server' })
    const child = spawn('uv', ['run', 'parla-voice', '--port', String(port)], {
      cwd: this.voiceProjectDir(),
      windowsHide: true,
      shell: process.platform === 'win32', // uv is uv.exe via PATH; shell resolves it
      // PYTHONUTF8: Windows defaults subprocess pipes to cp1252, which
      // mangles non-ASCII coming back from the Claude CLI (mojibake em-dashes).
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1' }
    })
    this.child = child
    child.stdout?.pipe(log)
    child.stderr?.pipe(log)
    child.on('exit', (code) => {
      if (this.status.state !== 'stopped') {
        this.setStatus({ state: 'error', port: null, detail: `voice server exited (${code})` })
      }
    })

    const deadline = Date.now() + BOOT_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (await this.health(port)) {
        await this.waitForModels(port)
        return
      }
      if (child.exitCode !== null) break
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }
    this.setStatus({
      state: 'error',
      port: null,
      detail: 'voice server failed to start — see logs/voice-server.log'
    })
  }

  /** The server answers /health immediately; models load in the background.
   *  Stay in 'starting' (with detail) until both engines report loaded. */
  private async waitForModels(port: number): Promise<void> {
    const deadline = Date.now() + BOOT_TIMEOUT_MS
    while (Date.now() < deadline) {
      const body = await this.health(port)
      if (body) {
        const models = body.models as { stt: boolean; tts: boolean }
        if (models.stt && models.tts) {
          this.setStatus({ state: 'ready', port, models })
          return
        }
        this.setStatus({ state: 'starting', port, models, detail: 'loading models' })
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }
    this.setStatus({ state: 'error', port: null, detail: 'models failed to load within 90s' })
  }

  async stop(): Promise<void> {
    const port = this.status.port
    this.setStatus({ state: 'stopped', port: null })
    if (this.adopted) return // externally-started dev server: leave it running
    if (port) {
      try {
        await fetch(`http://127.0.0.1:${port}/shutdown`, {
          method: 'POST',
          signal: AbortSignal.timeout(2000)
        })
      } catch {
        // already gone or unreachable — fall through to kill
      }
    }
    const child = this.child
    if (child && !this.adopted && child.exitCode === null) {
      const pid = child.pid
      await new Promise((r) => setTimeout(r, 1500))
      if (child.exitCode === null && pid) {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
      }
    }
  }
}
