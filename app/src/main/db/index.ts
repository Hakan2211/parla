// SQLite via better-sqlite3, owned by the main process. WAL mode; synchronous
// API keeps IPC handlers race-free. The voice worker never touches this —
// it stays stateless (docs principle #4).

import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { migrate } from './migrations'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    const path = join(app.getPath('userData'), 'parla.db')
    db = new Database(path)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    migrate(db)
  }
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
