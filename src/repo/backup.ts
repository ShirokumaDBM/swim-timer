import { db, newId } from '../db'
import { isLane } from '../domain/lanes'
import { convertLegacy, type LegacyData } from '../domain/legacy'
import type { Id, Session, Swimmer, TimeRecord } from '../domain/types'

export const BACKUP_FORMAT = 'swim-timer-backup'
/**
 * バックアップの形式の版。
 *  1: 番号が 1, 2, 3… の連番（以前の形式。読み込みのときに新しい番号へ変換する）
 *  2: 番号がランダムな文字列
 */
export const BACKUP_VERSION = 2

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
    swimmers: await db.swimmers.orderBy('createdAt').toArray(),
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
const isText = (v: unknown): v is string => typeof v === 'string' && v !== ''

function fail(msg: string): never {
  throw new BackupError(`バックアップファイルの内容が正しくありません（${msg}）。`)
}

/** 番号の形式は版によって違う（版1：正の整数、版2：文字列）。それ以外のチェックは共通 */
type IdCheck = (v: unknown) => boolean

function checkSwimmer(v: unknown, i: number, isId: IdCheck, needCreatedAt: boolean): Record<string, unknown> {
  const ok =
    isObj(v) &&
    isId(v.id) &&
    typeof v.name === 'string' &&
    v.name.trim() !== '' &&
    isOptStr(v.grade) &&
    (!needCreatedAt || typeof v.createdAt === 'number')
  if (!ok) fail(`選手 ${i + 1}件目`)
  const s = v as Record<string, unknown>
  return {
    id: s.id,
    name: s.name,
    ...(s.grade !== undefined && { grade: s.grade }),
    ...(needCreatedAt && { createdAt: s.createdAt }),
  }
}

function checkSession(v: unknown, i: number, isId: IdCheck): Record<string, unknown> {
  const ok =
    isObj(v) &&
    isId(v.id) &&
    typeof v.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(v.date) &&
    isPosInt(v.distance) &&
    isPosInt(v.reps) &&
    Array.isArray(v.swimmerIds) &&
    v.swimmerIds.every(isId) &&
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
  return v as Record<string, unknown>
}

function checkTime(v: unknown, i: number, isId: IdCheck): Record<string, unknown> {
  const ok =
    isObj(v) &&
    isId(v.sessionId) &&
    isId(v.swimmerId) &&
    isPosInt(v.rep) &&
    (v.centis === null || isPosInt(v.centis))
  if (!ok) fail(`タイム ${i + 1}件目`)
  const t = v as Record<string, unknown>
  return { sessionId: t.sessionId, swimmerId: t.swimmerId, rep: t.rep, centis: t.centis }
}

/**
 * ファイルの中身を読み取り、形式と整合性をチェックする（問題があれば BackupError）。
 * 以前の形式（版1）のファイルは、新しい番号に変換して返す。
 */
export function parseBackup(text: string, makeId: () => Id = newId): BackupData {
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

  const legacy = raw.version < 2
  const isId: IdCheck = legacy ? isPosInt : isText
  const swimmers = raw.swimmers.map((v, i) => checkSwimmer(v, i, isId, !legacy))
  const sessions = raw.sessions.map((v, i) => checkSession(v, i, isId))
  const times = raw.times.map((v, i) => checkTime(v, i, isId))

  // 参照の整合性（存在しない選手・測定を指していないか）
  const swimmerIds = new Set(swimmers.map((s) => s.id))
  const sessionById = new Map(sessions.map((s) => [s.id, s]))
  if (swimmerIds.size !== swimmers.length) fail('選手の番号が重複しています')
  if (sessionById.size !== sessions.length) fail('測定の番号が重複しています')
  sessions.forEach((s, i) => {
    if (!(s.swimmerIds as unknown[]).every((id) => swimmerIds.has(id))) {
      fail(`測定 ${i + 1}件目に存在しない選手が含まれています`)
    }
  })
  const timeKeys = new Set<string>()
  times.forEach((t, i) => {
    const s = sessionById.get(t.sessionId)
    if (!s || !(s.swimmerIds as unknown[]).includes(t.swimmerId) || (t.rep as number) > (s.reps as number)) {
      fail(`タイム ${i + 1}件目が存在しない測定・選手・本数を指しています`)
    }
    const key = `${String(t.sessionId)}-${String(t.swimmerId)}-${String(t.rep)}`
    if (timeKeys.has(key)) fail(`タイム ${i + 1}件目が重複しています`)
    timeKeys.add(key)
  })

  // ここまでのチェックで形は確かめてあるので、型を付けて返す
  const data = legacy
    ? convertLegacy({ swimmers, sessions, times } as unknown as LegacyData, makeId)
    : ({ swimmers, sessions, times } as unknown as Pick<BackupData, 'swimmers' | 'sessions' | 'times'>)
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    ...data,
  }
}

export function summarize(data: BackupData): DataSummary {
  return { swimmers: data.swimmers.length, sessions: data.sessions.length, times: data.times.length }
}

/**
 * 今のデータをすべて消して、バックアップの内容に置き換える（途中で失敗したら何も変わらない）。
 * クラウドと同期している端末では使えない（端末の記録がクラウドとずれてしまうため）。
 */
export async function importData(data: BackupData): Promise<void> {
  await db.transaction('rw', [db.swimmers, db.sessions, db.times, db.outbox, db.meta], async () => {
    if ((await db.meta.get('cloud:linked'))?.value === true) {
      throw new BackupError(
        'この端末はクラウドと同期しているため、バックアップの読み込みはできません。記録はクラウドから自動で届きます。',
      )
    }
    await Promise.all([db.swimmers.clear(), db.sessions.clear(), db.times.clear(), db.outbox.clear()])
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
