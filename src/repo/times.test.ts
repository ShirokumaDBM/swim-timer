import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { listTimes, saveCell } from './times'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('saveCell', () => {
  it('保存・上書き・欠損・消去', async () => {
    await saveCell(1, 10, 1, 3852)
    await saveCell(1, 10, 2, 3733)
    await saveCell(2, 10, 1, 4000) // 別の測定
    expect(await listTimes(1)).toHaveLength(2)

    await saveCell(1, 10, 1, 3900)
    await saveCell(1, 10, 2, null)
    expect(await listTimes(1)).toEqual([
      { sessionId: 1, swimmerId: 10, rep: 1, centis: 3900 },
      { sessionId: 1, swimmerId: 10, rep: 2, centis: null },
    ])

    await saveCell(1, 10, 2, undefined)
    expect((await listTimes(1)).map((t) => t.rep)).toEqual([1])
  })
})
