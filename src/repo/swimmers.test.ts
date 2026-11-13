import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  addSwimmer,
  deleteSwimmer,
  listSwimmers,
  SwimmerError,
  updateSwimmer,
} from './swimmers'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('addSwimmer', () => {
  it('登録すると保存される（前後の空白は除く）', async () => {
    const id = await addSwimmer({ name: '  山田 太郎 ', grade: ' 2年 ' })
    expect(await db.swimmers.get(id)).toEqual({ id, name: '山田 太郎', grade: '2年' })
  })

  it('学年は空なら保存しない', async () => {
    const id = await addSwimmer({ name: '佐藤', grade: '  ' })
    expect((await db.swimmers.get(id))?.grade).toBeUndefined()
  })

  it('名前が空ならエラー', async () => {
    await expect(addSwimmer({ name: '   ' })).rejects.toThrow(SwimmerError)
  })

  it('同じ名前は登録できない（大文字小文字・空白の違いも同じとみなす）', async () => {
    await addSwimmer({ name: 'Ken  Ito' })
    await expect(addSwimmer({ name: 'ken ito' })).rejects.toThrow('すでに登録')
  })
})

describe('listSwimmers', () => {
  it('登録順で返す', async () => {
    await addSwimmer({ name: 'B' })
    await addSwimmer({ name: 'A' })
    expect((await listSwimmers()).map((s) => s.name)).toEqual(['B', 'A'])
  })
})

describe('updateSwimmer', () => {
  it('名前と学年を変更できる', async () => {
    const id = await addSwimmer({ name: '山田', grade: '1年' })
    await updateSwimmer(id, { name: '山田 太郎', grade: '' })
    expect(await db.swimmers.get(id)).toEqual({ id, name: '山田 太郎', grade: undefined })
  })

  it('自分と同じ名前のままの保存はできるが、他の選手と同じ名前にはできない', async () => {
    const a = await addSwimmer({ name: 'A' })
    await addSwimmer({ name: 'B' })
    await expect(updateSwimmer(a, { name: 'A', grade: '2年' })).resolves.toBeUndefined()
    await expect(updateSwimmer(a, { name: 'B' })).rejects.toThrow('すでに登録')
  })
})

describe('deleteSwimmer', () => {
  it('記録のない選手は削除できる', async () => {
    const id = await addSwimmer({ name: 'A' })
    await deleteSwimmer(id)
    expect(await db.swimmers.get(id)).toBeUndefined()
  })

  it('タイムの記録がある選手は削除できない', async () => {
    const id = await addSwimmer({ name: 'A' })
    await db.times.put({ sessionId: 1, swimmerId: id, rep: 1, centis: 3852 })
    await expect(deleteSwimmer(id)).rejects.toThrow('過去の記録')
    expect(await db.swimmers.get(id)).toBeDefined()
  })

  it('測定に参加登録されている選手は削除できない', async () => {
    const id = await addSwimmer({ name: 'A' })
    await db.sessions.add({
      date: '2026-11-07',
      distance: 50,
      reps: 20,
      swimmerIds: [id],
      status: 'in_progress',
      createdAt: 0,
    })
    await expect(deleteSwimmer(id)).rejects.toThrow('過去の記録')
  })
})
