import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { listTimes, saveCell } from './times'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('saveCell', () => {
  it('保存・上書き・欠損・消去', async () => {
    await saveCell('s1', 'w10', 1, 3852)
    await saveCell('s1', 'w10', 2, 3733)
    await saveCell('s2', 'w10', 1, 4000) // 別の測定
    expect(await listTimes('s1')).toHaveLength(2)

    await saveCell('s1', 'w10', 1, 3900)
    await saveCell('s1', 'w10', 2, null)
    expect(await listTimes('s1')).toEqual([
      { sessionId: 's1', swimmerId: 'w10', rep: 1, centis: 3900 },
      { sessionId: 's1', swimmerId: 'w10', rep: 2, centis: null },
    ])

    await saveCell('s1', 'w10', 2, undefined)
    expect((await listTimes('s1')).map((t) => t.rep)).toEqual([1])
  })
})
