// What a launch asked for. Studio starts Parla with `--studio-project <id>`
// ("Talk it through") or `--open-chat <chat_id>` (back to the conversation a
// proposal came from). The first start reads its own argv; later starts reach
// the running window through 'second-instance'. The renderer takes the
// latest intent when it's ready, and again on each 'launch:intent' push.

import type { BrowserWindow } from 'electron'
import type { LaunchIntent } from '@shared/types'

const ID = /^[A-Za-z0-9_-]{1,80}$/

function valueAfter(argv: string[], flag: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === flag) return argv[i + 1]
    if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1)
  }
  return undefined
}

/** Ids only: anything that isn't a plain id is ignored. */
export function parseLaunchArgs(argv: string[]): LaunchIntent {
  const intent: LaunchIntent = {}
  const project = valueAfter(argv, '--studio-project')?.trim()
  const chat = valueAfter(argv, '--open-chat')?.trim()
  if (project && ID.test(project)) intent.studioProject = project
  if (chat && ID.test(chat)) intent.openChat = chat
  return intent
}

let pending: LaunchIntent | null = null
let win: BrowserWindow | null = null

export function setLaunchWindow(w: BrowserWindow): void {
  win = w
}

export function pushLaunchIntent(intent: LaunchIntent): void {
  if (!intent.studioProject && !intent.openChat) return
  pending = intent
  if (win && !win.isDestroyed()) win.webContents.send('launch:intent')
}

/** The renderer takes the intent once; a later launch replaces it. */
export function takeLaunchIntent(): LaunchIntent | null {
  const i = pending
  pending = null
  return i
}
