import { db } from '../db'
import type { CellValue } from '../domain/grid'
import type { TimeRecord } from '../domain/types'

export function listTimes(sessionId: number): Promise<TimeRecord[]> {
  return db.times.where('sessionId').equals(sessionId).toArray()
}

/**
 * 1マス分を保存する（入力のたびに呼ぶ＝自動保存）。
 * value: タイム / null = 欠損 / undefined = 消去（未入力に戻す）
 */
export async function saveCell(
  sessionId: number,
  swimmerId: number,
  rep: number,
  value: CellValue,
): Promise<void> {
  if (value === undefined) {
    await db.times.delete([sessionId, swimmerId, rep])
  } else {
    await db.times.put({ sessionId, swimmerId, rep, centis: value })
  }
}
