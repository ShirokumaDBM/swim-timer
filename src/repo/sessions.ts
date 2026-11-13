import { db } from '../db'
import { compareChronological } from '../domain/compare'
import { hasLanes, isLane, MAX_LANE } from '../domain/lanes'
import type { Session } from '../domain/types'

export class SessionError extends Error {}

export interface SessionInput {
  date: string
  distance: number
  reps: number
  stroke?: string
  circle?: string
  memo?: string
  swimmerIds: number[]
  /** 選手ID → レーン（任意。参加していない選手の分は無視する） */
  lanes?: Record<number, number | undefined>
}

export const MAX_REPS = 100

/** 入力を検証・整形する（問題があれば SessionError） */
export function normalizeSessionInput(input: SessionInput): Omit<Session, 'id' | 'status' | 'createdAt'> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new SessionError('測定日を入力してください。')
  if (!Number.isInteger(input.distance) || input.distance <= 0) {
    throw new SessionError('距離は1以上の整数で入力してください。')
  }
  if (!Number.isInteger(input.reps) || input.reps < 1 || input.reps > MAX_REPS) {
    throw new SessionError(`本数は1〜${MAX_REPS}の整数で入力してください。`)
  }
  const swimmerIds = [...new Set(input.swimmerIds)]
  if (swimmerIds.length === 0) throw new SessionError('参加する選手を1人以上選んでください。')
  const lanes = swimmerIds.map((id) => input.lanes?.[id] ?? null)
  if (!lanes.every((l) => l == null || isLane(l))) {
    throw new SessionError(`レーンは1〜${MAX_LANE}で選んでください。`)
  }
  const opt = (s?: string) => s?.trim() || undefined
  return {
    date: input.date,
    distance: input.distance,
    reps: input.reps,
    stroke: opt(input.stroke),
    circle: opt(input.circle),
    memo: opt(input.memo),
    swimmerIds,
    lanes: hasLanes(lanes) ? lanes : undefined,
  }
}

/** 測定を作成する（状態は「入力中」） */
export async function createSession(input: SessionInput, now = Date.now()): Promise<number> {
  const data = normalizeSessionInput(input)
  return db.transaction('rw', db.sessions, db.swimmers, async () => {
    const found = await db.swimmers.bulkGet(data.swimmerIds)
    if (found.some((s) => !s)) throw new SessionError('削除された選手が含まれています。選び直してください。')
    return (await db.sessions.add({ ...data, status: 'in_progress', createdAt: now })) as number
  })
}

/**
 * 測定の設定を変更する。外した選手のタイムと、減らした本数より後のタイムは削除する。
 * 戻り値は削除したタイムの件数。
 */
export async function updateSession(id: number, input: SessionInput): Promise<number> {
  const data = normalizeSessionInput(input)
  return db.transaction('rw', db.sessions, db.swimmers, db.times, async () => {
    const current = await db.sessions.get(id)
    if (!current) throw new SessionError('この測定は削除されています。')
    const found = await db.swimmers.bulkGet(data.swimmerIds)
    if (found.some((s) => !s)) throw new SessionError('削除された選手が含まれています。選び直してください。')
    const keep = new Set(data.swimmerIds)
    const removed = await db.times
      .where('sessionId')
      .equals(id)
      .filter((t) => !keep.has(t.swimmerId) || t.rep > data.reps)
      .delete()
    await db.sessions.put({ ...current, ...data, id })
    return removed
  })
}

export function getSession(id: number): Promise<Session | undefined> {
  return db.sessions.get(id)
}

/** 測定と、その測定のタイムをすべて削除する */
export async function deleteSession(id: number): Promise<void> {
  await db.transaction('rw', db.sessions, db.times, async () => {
    await db.times.where('sessionId').equals(id).delete()
    await db.sessions.delete(id)
  })
}

/** 新しい順 */
async function listSessionsDesc(filter?: (s: Session) => boolean): Promise<Session[]> {
  const all = await db.sessions.toArray()
  return all.filter(filter ?? (() => true)).sort((a, b) => compareChronological(b, a))
}

/** すべての測定（新しい順） */
export function listSessions(): Promise<Session[]> {
  return listSessionsDesc()
}

/** 入力中の測定（新しい順） */
export function listInProgressSessions(): Promise<Session[]> {
  return listSessionsDesc((s) => s.status === 'in_progress')
}

/** 一番新しい測定（前回の設定のコピー用） */
export async function getLatestSession(): Promise<Session | undefined> {
  return (await listSessionsDesc())[0]
}
