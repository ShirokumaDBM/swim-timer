import { db } from '../db'
import { isLane } from '../domain/lanes'
import type { Session, Swimmer, TimeRecord } from '../domain/types'

export const BACKUP_FORMAT = 'swim-timer-backup'
export const BACKUP_VERSION = 1

export interface BackupData {
  format: typeof BACKUP_FORMAT
  version: number
  /** ISO 8601 */
  exportedAt: string
  swimmers: Swimmer[]
  sessions: Session[]
  times: TimeRecord[]
}

export class BackupError extends Error {}

/** 今のデータをすべて書き出す */
export async function exportData(now = new Date()): Promise<BackupData> {
  return db.transaction('r', db.swimmers, db.sessions, db.times, async () => ({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    swimmers: await db.swimmers.toArray(),
    sessions: await db.sessions.toArray(),
    times: await db.times.toArray(),
  }))
}

export interface DataSummary {
  swimmers: number
  sessions: number
  times: number
}

export async function currentSummary(): Promise<DataSummary> {
  const [swimmers, sessions, times] = await Promise.all([
    db.swimmers.count(),
    db.sessions.count(),
    db.times.count(),
  ])
  return { swimmers, sessions, times }
}

// ---------- 読み込み時のチェック ----------

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isPosInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0
const isOptStr = (v: unknown) => v === undefined || typeof v === 'string'

function fail(msg: string): never {
  throw new BackupError(`バックアップファイルの内容が正しくありません（${msg}）。`)
}

function checkSwimmer(v: unknown, i: number): Swimmer {
  if (!isObj(v) || !isPosInt(v.id) || typeof v.name !== 'string' || v.name.trim() === '' || !isOptStr(v.grade)) {
    fail(`選手 ${i + 1}件目`)
  }
  return { id: v.id, name: v.name, ...(v.grade !== undefined && { grade: v.grade as string }) }
}

function checkSession(v: unknown, i: number): Session {
  const ok =
    isObj(v) &&
    isPosInt(v.id) &&
    typeof v.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(v.date) &&
    isPosInt(v.distance) &&
    isPosInt(v.reps) &&
    Array.isArray(v.swimmerIds) &&
    v.swimmerIds.every(isPosInt) &&
    (v.lanes === undefined ||
      (Array.isArray(v.lanes) &&
        v.lanes.length === v.swimmerIds.length &&
        v.lanes.every((l) => l === null || isLane(l)))) &&
    (v.status === 'in_progress' || v.status === 'finished') &&
    typeof v.createdAt === 'number' &&
    isOptStr(v.stroke) &&
    isOptStr(v.circle) &&
    isOptStr(v.memo)
  if (!ok) fail(`測定 ${i + 1}件目`)
  return v as unknown as Session
}

function checkTime(v: unknown, i: number): TimeRecord {
  const ok =
    isObj(v) &&
    isPosInt(v.sessionId) &&
    isPosInt(v.swimmerId) &&
    isPosInt(v.rep) &&
    (v.centis === null || isPosInt(v.centis))
  if (!ok) fail(`タイム ${i + 1}件目`)
  return { sessionId: v.sessionId, swimmerId: v.swimmerId, rep: v.rep, centis: v.centis } as TimeRecord
}

/** ファイルの中身を読み取り、形式と整合性をチェックする（問題があれば BackupError） */
export function parseBackup(text: string): BackupData {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BackupError('JSON ファイルとして読み込めませんでした。バックアップで書き出したファイルを選んでください。')
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) {
    throw new BackupError('このアプリのバックアップファイルではありません。')
  }
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) {
    throw new BackupError('新しいバージョンのアプリで書き出されたファイルのため、読み込めません。')
  }
  if (!Array.isArray(raw.swimmers) || !Array.isArray(raw.sessions) || !Array.isArray(raw.times)) {
    fail('データの一覧がありません')
  }

  const swimmers = raw.swimmers.map(checkSwimmer)
  const sessions = raw.sessions.map(checkSession)
  const times = raw.times.map(checkTime)

  // 参照の整合性（存在しない選手・測定を指していないか）
  const swimmerIds = new Set(swimmers.map((s) => s.id))
  const sessionById = new Map(sessions.map((s) => [s.id, s]))
  if (swimmerIds.size !== swimmers.length) fail('選手の番号が重複しています')
  if (sessionById.size !== sessions.length) fail('測定の番号が重複しています')
  sessions.forEach((s, i) => {
    if (!s.swimmerIds.every((id) => swimmerIds.has(id))) fail(`測定 ${i + 1}件目に存在しない選手が含まれています`)
  })
  const timeKeys = new Set<string>()
  times.forEach((t, i) => {
    const s = sessionById.get(t.sessionId)
    if (!s || !s.swimmerIds.includes(t.swimmerId) || t.rep > s.reps) {
      fail(`タイム ${i + 1}件目が存在しない測定・選手・本数を指しています`)
    }
    const key = `${t.sessionId}-${t.swimmerId}-${t.rep}`
    if (timeKeys.has(key)) fail(`タイム ${i + 1}件目が重複しています`)
    timeKeys.add(key)
  })

  return {
    format: BACKUP_FORMAT,
    version: raw.version,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    swimmers,
    sessions,
    times,
  }
}

export function summarize(data: BackupData): DataSummary {
  return { swimmers: data.swimmers.length, sessions: data.sessions.length, times: data.times.length }
}

/** 今のデータをすべて消して、バックアップの内容に置き換える（途中で失敗したら何も変わらない） */
export async function importData(data: BackupData): Promise<void> {
  await db.transaction('rw', db.swimmers, db.sessions, db.times, async () => {
    await Promise.all([db.swimmers.clear(), db.sessions.clear(), db.times.clear()])
    await db.swimmers.bulkAdd(data.swimmers)
    await db.sessions.bulkAdd(data.sessions)
    await db.times.bulkAdd(data.times)
  })
}

/** 'swim-timer-backup-2026-11-07-2130.json' */
export function backupFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `swim-timer-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`
}
