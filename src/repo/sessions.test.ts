import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  createSession,
  deleteSession,
  getLatestSession,
  getSession,
  listInProgressSessions,
  normalizeSessionInput,
  SessionError,
  type SessionInput,
  updateSession,
} from './sessions'
import { addSwimmer, deleteSwimmer } from './swimmers'
import { saveCell } from './times'

let a: string
let b: string

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  a = await addSwimmer({ name: 'A' })
  b = await addSwimmer({ name: 'B' })
})

const base = (): SessionInput => ({ date: '2026-11-07', distance: 50, reps: 30, swimmerIds: [a, b] })

describe('normalizeSessionInput', () => {
  it('任意項目の空白は保存しない、選手の重複は除く', () => {
    const r = normalizeSessionInput({ ...base(), stroke: ' Fr ', circle: ' ', memo: '', swimmerIds: [a, a, b] })
    expect(r).toEqual({ ...base(), stroke: 'Fr', circle: undefined, memo: undefined, swimmerIds: [a, b] })
  })

  it.each([
    [{ date: '' }, '測定日'],
    [{ distance: 0 }, '距離'],
    [{ distance: 12.5 }, '距離'],
    [{ reps: 0 }, '本数'],
    [{ reps: 101 }, '本数'],
    [{ reps: 2.5 }, '本数'],
    [{ reps: NaN }, '本数'],
    [{ swimmerIds: [] }, '選手'],
  ])('%o はエラー', (patch, msg) => {
    expect(() => normalizeSessionInput({ ...base(), ...patch })).toThrow(msg)
  })

  it.each([6, 0, 1.5])('レーン %s はエラー', (lane) => {
    expect(() => normalizeSessionInput({ ...base(), lanes: { [a]: lane } })).toThrow('レーン')
  })

  it('レーンは参加選手の並びの配列にする（未設定は null、参加していない選手は無視）', () => {
    const r = normalizeSessionInput({ ...base(), swimmerIds: [b, a], lanes: { [a]: 3, none: 1 } })
    expect(r.lanes).toEqual([null, 3])
  })

  it('誰もレーンを設定していなければ lanes は保存しない', () => {
    expect(normalizeSessionInput({ ...base(), lanes: {} }).lanes).toBeUndefined()
    expect(normalizeSessionInput({ ...base(), lanes: { [a]: undefined } }).lanes).toBeUndefined()
  })
})

describe('updateSession', () => {
  it('設定を変更できる（状態・作成日時はそのまま）', async () => {
    const id = await createSession({ ...base(), lanes: { [a]: 1 } }, 1234)
    const removed = await updateSession(id, { ...base(), date: '2026-11-08', distance: 25, reps: 40, memo: '変更' })
    expect(removed).toBe(0)
    const s = await getSession(id)
    expect(s).toMatchObject({ date: '2026-11-08', distance: 25, reps: 40, memo: '変更', status: 'in_progress', createdAt: 1234 })
    expect(s!.lanes).toBeUndefined()
  })

  it('外した選手のタイムと、減らした本数より後のタイムを消す', async () => {
    const id = await createSession(base())
    await saveCell(id, a, 1, 3800)
    await saveCell(id, a, 25, 3900)
    await saveCell(id, b, 1, 4000)
    const removed = await updateSession(id, { ...base(), reps: 20, swimmerIds: [a] })
    expect(removed).toBe(2)
    expect(await db.times.where('sessionId').equals(id).toArray()).toEqual([
      { sessionId: id, swimmerId: a, rep: 1, centis: 3800 },
    ])
  })

  it('入力が不正なら何も変わらない', async () => {
    const id = await createSession(base())
    await saveCell(id, b, 1, 4000)
    await expect(updateSession(id, { ...base(), swimmerIds: [] })).rejects.toThrow(SessionError)
    await expect(updateSession(id, { ...base(), swimmerIds: [a, 'none'] })).rejects.toThrow('削除された選手')
    expect(await getSession(id)).toMatchObject({ swimmerIds: [a, b] })
    expect(await db.times.count()).toBe(1)
  })

  it('削除された測定はエラー', async () => {
    await expect(updateSession('none', base())).rejects.toThrow('削除されています')
  })
})

describe('createSession', () => {
  it('「入力中」として保存される', async () => {
    const id = await createSession({ ...base(), stroke: 'Fr' }, 1234)
    expect(await getSession(id)).toEqual({
      id,
      ...base(),
      stroke: 'Fr',
      circle: undefined,
      memo: undefined,
      status: 'in_progress',
      createdAt: 1234,
    })
  })

  it('存在しない選手が含まれるとエラー', async () => {
    await expect(createSession({ ...base(), swimmerIds: [a, 'none'] })).rejects.toThrow(SessionError)
    expect(await db.sessions.count()).toBe(0)
  })
})

describe('deleteSession', () => {
  it('測定とそのタイムを削除し、他の測定には影響しない', async () => {
    const s1 = await createSession(base(), 1)
    const s2 = await createSession(base(), 2)
    await saveCell(s1, a, 1, 3852)
    await saveCell(s1, b, 1, 3733)
    await saveCell(s2, a, 1, 4000)

    await deleteSession(s1)
    expect(await getSession(s1)).toBeUndefined()
    expect(await db.times.where('sessionId').equals(s1).count()).toBe(0)
    expect(await getSession(s2)).toBeDefined()
    expect(await db.times.where('sessionId').equals(s2).count()).toBe(1)
  })

  it('削除すると、その測定に参加していた選手を削除できるようになる', async () => {
    const s1 = await createSession(base(), 1)
    await saveCell(s1, a, 1, 3852)
    await deleteSession(s1)
    await expect(deleteSwimmer(a)).resolves.toBeUndefined()
  })
})

describe('listInProgressSessions / getLatestSession', () => {
  it('入力中だけを新しい順に返す', async () => {
    const s1 = await createSession({ ...base(), date: '2026-11-01' }, 1)
    const s2 = await createSession({ ...base(), date: '2026-11-07' }, 2)
    const s3 = await createSession({ ...base(), date: '2026-11-03' }, 3)
    await db.sessions.update(s2, { status: 'finished' })
    expect((await listInProgressSessions()).map((s) => s.id)).toEqual([s3, s1])
    expect((await getLatestSession())?.id).toBe(s2)
  })

  it('測定がなければ undefined', async () => {
    expect(await getLatestSession()).toBeUndefined()
  })
})

describe('記録係', () => {
  it('記録係は重複を除いて保存し、誰もいなければ保存しない', () => {
    expect(normalizeSessionInput({ ...base(), recorderIds: ['u1', 'u1', 'u2'] }).recorderIds).toEqual(['u1', 'u2'])
    expect(normalizeSessionInput({ ...base(), recorderIds: [] }).recorderIds).toBeUndefined()
    expect(normalizeSessionInput(base()).recorderIds).toBeUndefined()
  })

  it('作成・変更で記録係が保存される', async () => {
    const id = await createSession({ ...base(), recorderIds: ['u1'] })
    expect((await getSession(id))!.recorderIds).toEqual(['u1'])
    await updateSession(id, { ...base(), recorderIds: ['u2'] })
    expect((await getSession(id))!.recorderIds).toEqual(['u2'])
  })
})
