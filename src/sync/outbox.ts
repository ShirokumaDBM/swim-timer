import { db, type OutboxEntry, type SyncRef } from '../db'

/** 行を表す文字列 */
export function refKey(ref: SyncRef): string {
  return ref.table === 'times' ? `times:${ref.sessionId}:${ref.swimmerId}:${ref.rep}` : `${ref.table}:${ref.id}`
}

let counter = 0
/** 変えた順番（同じミリ秒に何件変えても重ならない） */
function nextSeq(): number {
  counter = (counter + 1) % 1000
  return Date.now() * 1000 + counter
}

/**
 * この端末で変えた行を、送信待ちに入れる。
 * 変更と同じトランザクションの中で呼ぶこと（db.outbox をトランザクションに含める）。
 * 変更は保存されたのに送信待ちに入っていない、ということが起きないようにするため。
 */
export async function track(...refs: SyncRef[]): Promise<void> {
  if (refs.length === 0) return
  await db.outbox.bulkPut(refs.map((ref): OutboxEntry => ({ key: refKey(ref), ref, seq: nextSeq() })))
}

export const swimmerRef = (id: string): SyncRef => ({ table: 'swimmers', id })
export const sessionRef = (id: string): SyncRef => ({ table: 'sessions', id })
export const timeRef = (t: { sessionId: string; swimmerId: string; rep: number }): SyncRef => ({
  table: 'times',
  sessionId: t.sessionId,
  swimmerId: t.swimmerId,
  rep: t.rep,
})

/** 送信待ちの件数 */
export function pendingCount(): Promise<number> {
  return db.outbox.count()
}
