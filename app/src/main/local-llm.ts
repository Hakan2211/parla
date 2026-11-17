// Local LLM lifecycle via LM Studio: start its server, load the chosen model
// onto the GPU, and unload it on quit if Parla loaded it.
//
// Model state, load and unload go through LM Studio's REST API
// (/api/v1/models, /api/v1/models/load, /api/v1/models/unload): it returns
// exactly when the daemon is done. The `lms` CLI is used only to start the
// server (the API can't do that while it's down) and to list models while
// the server is off. Measured gotcha: `lms load` / `lms unload` /
// `lms ps` intermittently never exit without a terminal (45s+ hangs from
// Node, even after the daemon finished), so they are not used for state.
//
// Load time for gemma-4-26b-a4b-it: ~1-6s from a warm disk cache, 66-141s
// cold. It is kicked off in the background at app start; session start only
// waits for whatever is still in flight.

import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import type { LocalModel, LocalStatus } from '@shared/types'

const run = promisify(execFile)

export const LMSTUDIO_DEFAULT_URL = 'http://127.0.0.1:1234/v1'
export const LOCAL_DEFAULT_MODEL = 'gemma-4-26b-a4b-it'
// 16k fits beside Kokoro + Parakeet on the 24GB card (~23GB total, measured
// estimate) and comfortably holds a windowed hour-long conversation.
const CONTEXT_LENGTH = 16384
const LOAD_TIMEOUT_MS = 300_000

/** 'http://127.0.0.1:1234/v1' -> 'http://127.0.0.1:1234' (REST API root). */
function apiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '')
}

function lmsPath(): string | null {
  const bundled = join(homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms')
  return existsSync(bundled) ? bundled : null
}

async function serverUp(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

/** Start the server with the CLI, but judge success by polling the server itself. */
async function startServer(baseUrl: string): Promise<void> {
  const bin = lmsPath()
  if (!bin) throw new Error('LM Studio is not installed (lms CLI not found).')
  const child = spawn(bin, ['server', 'start'], { windowsHide: true, stdio: 'ignore' })
  let exitCode: number | null | undefined
  child.on('exit', (code) => (exitCode = code))
  child.on('error', () => (exitCode = -1))
  try {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (await serverUp(baseUrl)) return
      if (exitCode !== undefined && exitCode !== 0) {
        throw new Error(`lms server start failed (exit ${exitCode})`)
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error('LM Studio server did not start within 30s.')
  } finally {
    if (exitCode === undefined) child.kill()
  }
}

interface RestModel {
  type: string
  key: string
  params_string?: string | null
  size_bytes?: number
  loaded_instances?: { id: string }[]
}

async function restModels(baseUrl: string): Promise<RestModel[]> {
  const res = await fetch(`${apiRoot(baseUrl)}/api/v1/models`, {
    signal: AbortSignal.timeout(5000)
  })
  if (!res.ok) throw new Error(`LM Studio model list failed (${res.status})`)
  const body = (await res.json()) as { models?: RestModel[]; data?: RestModel[] }
  return body.models ?? body.data ?? []
}

async function isLoaded(model: string, baseUrl: string): Promise<boolean> {
  const models = await restModels(baseUrl)
  return models.some((m) => m.key === model && (m.loaded_instances?.length ?? 0) > 0)
}

let loading: Promise<void> | null = null
let loadingKey: string | null = null
/** Instance ids Parla loaded (and so may unload), with the server they live on. */
const loadedByParla = new Map<string, string>()

export async function localStatus(baseUrl = LMSTUDIO_DEFAULT_URL): Promise<LocalStatus> {
  if (!lmsPath()) return { available: false, serverUp: false, loading: null, models: [] }
  try {
    const up = await serverUp(baseUrl)
    let models: LocalModel[]
    if (up) {
      models = (await restModels(baseUrl))
        .filter((m) => m.type === 'llm')
        .map((m) => ({
          key: m.key,
          params: m.params_string ?? null,
          sizeGb: (m.size_bytes ?? 0) / 1e9,
          loaded: (m.loaded_instances?.length ?? 0) > 0
        }))
    } else {
      // Server off: `lms ls` reads the model folder and exits reliably.
      const { stdout } = await run(lmsPath()!, ['ls', '--json'], {
        timeout: 10_000,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024
      })
      models = (
        JSON.parse(stdout) as {
          type?: string
          modelKey: string
          paramsString?: string
          sizeBytes?: number
        }[]
      )
        .filter((m) => m.type === 'llm')
        .map((m) => ({
          key: m.modelKey,
          params: m.paramsString ?? null,
          sizeGb: (m.sizeBytes ?? 0) / 1e9,
          loaded: false
        }))
    }
    return { available: true, serverUp: up, loading: loading ? loadingKey : null, models }
  } catch (e) {
    return {
      available: true,
      serverUp: false,
      loading: loading ? loadingKey : null,
      models: [],
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

/** Start the server and load `model` if needed. Concurrent callers share one load. */
export function ensureLocalModel(model: string, baseUrl = LMSTUDIO_DEFAULT_URL): Promise<void> {
  if (loading && loadingKey === model) return loading
  // Claim the slot synchronously: a second caller in the same tick must see
  // it, or LM Studio gets two copies of a 19GB model (it happened in testing).
  loadingKey = model
  const job = (async () => {
    if (!(await serverUp(baseUrl))) await startServer(baseUrl)
    if (await isLoaded(model, baseUrl)) {
      console.log(`[local-llm] ${model} already loaded (not owned by Parla)`)
      return
    }
    // Owned from the moment we ask: quitting mid-load must still unload it.
    loadedByParla.set(model, baseUrl)
    console.log(`[local-llm] loading ${model}`)
    const res = await fetch(`${apiRoot(baseUrl)}/api/v1/models/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, context_length: CONTEXT_LENGTH }),
      signal: AbortSignal.timeout(LOAD_TIMEOUT_MS)
    })
    if (!res.ok) throw new Error(`LM Studio load failed (${res.status}): ${await res.text()}`)
    const body = (await res.json()) as { instance_id?: string; load_time_seconds?: number }
    if (body.instance_id && body.instance_id !== model) {
      loadedByParla.delete(model)
      loadedByParla.set(body.instance_id, baseUrl)
    }
    console.log(`[local-llm] loaded ${model} in ${body.load_time_seconds?.toFixed(1) ?? '?'}s`)
  })()
  loading = job
  job
    .finally(() => {
      if (loading === job) {
        loading = null
        loadingKey = null
      }
    })
    .catch(() => {})
  return job
}

/** True only while a load is actually in flight. */
export function isLoading(model: string): boolean {
  return loading !== null && loadingKey === model
}

/** Free the GPU on quit — only instances Parla itself loaded. */
export async function unloadParlaModels(): Promise<void> {
  for (const [instanceId, baseUrl] of loadedByParla) {
    try {
      const res = await fetch(`${apiRoot(baseUrl)}/api/v1/models/unload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance_id: instanceId }),
        signal: AbortSignal.timeout(15_000)
      })
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
      console.log(`[local-llm] unloaded ${instanceId}`)
    } catch (e) {
      // best effort; LM Studio may already be gone
      console.warn(`[local-llm] unload ${instanceId} failed`, e)
    }
  }
  loadedByParla.clear()
}
