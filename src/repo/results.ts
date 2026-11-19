import { db } from '../db'
import { sessionRef, track } from '../sync/outbox'
import { compareChronological, type SessionDetail, type SessionSummary } from '../domain/compare'
import type { HistoryRow } from '../domain/history'
import type { Centis, Id, RepTimes, Session, TimeRecord } from '../domain/types'

/** 測定を終了（確定）する。終了後もタイムの修正はできる */
export async function finishSession(id: Id): Promise<void> {
  await db.transaction('rw', db.sessions, db.outbox, async () => {
    const updated = await db.sessions.update(id, { status: 'finished' })
    if (!updated) throw new Error('この測定は削除されています。')
    await track(sessionRef(id))
  })
}

/** 終了した測定（新しい順） */
export async function listFinishedSessions(): Promise<Session[]> {
  const all = await db.sessions.where('status').equals('finished').toArray()
  return all.sort((a, b) => compareChronological(b, a))
}

/** 各選手の平均タイム（1/100秒に丸める。1本も記録がない選手は含めない） */
export function averagesBySwimmer(records: readonly TimeRecord[]): Map<Id, Centis> {
  const sums = new Map<Id, { total: number; count: number }>()
  for (const t of records) {
    if (t.centis == null) continue
    const s = sums.get(t.swimmerId) ?? { total: 0, count: 0 }
    s.total += t.centis
    s.count += 1
    sums.set(t.swimmerId, s)
  }
  return new Map([...sums].map(([id, s]) => [id, Math.round(s.total / s.count)]))
}

/** 履歴の一覧（新しい順）。各測定の入力件数と選手ごとの平均つき */
export async function loadHistory(): Promise<HistoryRow[]> {
  const [sessions, records] = await Promise.all([db.sessions.toArray(), db.times.toArray()])
  const bySession = new Map<Id, TimeRecord[]>()
  for (const t of records) {
    const list = bySession.get(t.sessionId) ?? []
    list.push(t)
    bySession.set(t.sessionId, list)
  }
  return sessions
    .sort((a, b) => compareChronological(b, a))
    .map((session) => {
      const list = bySession.get(session.id) ?? []
      return { session, timeCount: list.length, averages: averagesBySwimmer(list) }
    })
}

/** 距離・本数が同じ、終了した測定の1本ごとのタイム（比較・推移グラフ用。並び順は問わない） */
export async function loadSessionDetails(distance: number, reps: number): Promise<SessionDetail[]> {
  const sessions = await db.sessions
    .where('[distance+reps]')
    .equals([distance, reps])
    .filter((s) => s.status === 'finished')
    .toArray()
  if (sessions.length === 0) return []
  const records = await db.times
    .where('sessionId')
    .anyOf(sessions.map((s) => s.id))
    .toArray()
  const bySession = new Map<Id, Map<Id, RepTimes>>()
  for (const t of records) {
    if (t.rep < 1 || t.rep > reps) continue
    const times = bySession.get(t.sessionId) ?? new Map<Id, RepTimes>()
    const list = times.get(t.swimmerId) ?? Array.from<Centis | null>({ length: reps }).fill(null)
    list[t.rep - 1] = t.centis
    times.set(t.swimmerId, list)
    bySession.set(t.sessionId, times)
  }
  return sessions.map((session) => ({ session, times: bySession.get(session.id) ?? new Map() }))
}

/** すべての測定（入力中も含む）の1本ごとのタイム（日ごとの推移グラフ用。並び順は問わない） */
export async function loadAllDetails(): Promise<SessionDetail[]> {
  const [sessions, records] = await Promise.all([db.sessions.toArray(), db.times.toArray()])
  const repsOf = new Map(sessions.map((s) => [s.id, s.reps]))
  const bySession = new Map<Id, Map<Id, RepTimes>>()
  for (const t of records) {
    const reps = repsOf.get(t.sessionId)
    if (reps == null || t.rep < 1 || t.rep > reps) continue
    const times = bySession.get(t.sessionId) ?? new Map<Id, RepTimes>()
    const list = times.get(t.swimmerId) ?? Array.from<Centis | null>({ length: reps }).fill(null)
    list[t.rep - 1] = t.centis
    times.set(t.swimmerId, list)
    bySession.set(t.sessionId, times)
  }
  return sessions.map((session) => ({ session, times: bySession.get(session.id) ?? new Map() }))
}

/** 距離・本数が同じ、終了した測定の平均タイム（比較用。並び順は問わない） */
export async function loadSummaries(distance: number, reps: number): Promise<SessionSummary[]> {
  const sessions = await db.sessions
    .where('[distance+reps]')
    .equals([distance, reps])
    .filter((s) => s.status === 'finished')
    .toArray()
  if (sessions.length === 0) return []
  const records = await db.times
    .where('sessionId')
    .anyOf(sessions.map((s) => s.id))
    .toArray()
  const bySession = new Map<Id, TimeRecord[]>()
  for (const t of records) {
    const list = bySession.get(t.sessionId) ?? []
    list.push(t)
    bySession.set(t.sessionId, list)
  }
  return sessions.map((session) => ({ session, averages: averagesBySwimmer(bySession.get(session.id) ?? []) }))
}
