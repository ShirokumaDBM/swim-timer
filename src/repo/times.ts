import { db } from '../db'
import { timeRef, track } from '../sync/outbox'
import type { CellValue } from '../domain/grid'
import type { Id, TimeRecord } from '../domain/types'

export function listTimes(sessionId: Id): Promise<TimeRecord[]> {
  return db.times.where('sessionId').equals(sessionId).toArray()
}

/**
 * 1マス分を保存する（入力のたびに呼ぶ＝自動保存）。
 * value: タイム / null = 欠損 / undefined = 消去（未入力に戻す）
 */
export async function saveCell(
  sessionId: Id,
  swimmerId: Id,
  rep: number,
  value: CellValue,
): Promise<void> {
  await db.transaction('rw', db.times, db.outbox, async () => {
    if (value === undefined) {
      await db.times.delete([sessionId, swimmerId, rep])
    } else {
      await db.times.put({ sessionId, swimmerId, rep, centis: value })
    }
    await track(timeRef({ sessionId, swimmerId, rep }))
  })
}

/** その測定に入力済みのタイムの件数（欠損も含む） */
export function countTimes(sessionId: Id): Promise<number> {
  return db.times.where('sessionId').equals(sessionId).count()
}
