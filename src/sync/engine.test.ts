import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { finishSession } from '../repo/results'
import { createSession, deleteSession } from '../repo/sessions'
import { addSwimmer, listSwimmers, updateSwimmer } from '../repo/swimmers'
import { listTimes, saveCell } from '../repo/times'
import { adoptCloud, isLinked, PAGE_SIZE, syncOnce, uploadLocal, type SyncContext } from './engine'
import { FakeRemote } from './fakeRemote'
import type { SessionRow, SwimmerRow, TimeRow } from './remote'

const admin: SyncContext = { role: 'admin', userId: 'admin' }

let remote: FakeRemote

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  remote = new FakeRemote()
})

const swimmerRow = (id: string, name: string, created_at = 1): SwimmerRow => ({ id, name, grade: null, created_at, deleted: false })
const sessionRow = (id: string, swimmer_ids: string[], reps = 3, recorder_ids: string[] = [], status: SessionRow['status'] = 'in_progress'): SessionRow => ({
  id,
  date: '2026-11-20',
  distance: 50,
  reps,
  stroke: null,
  circle: null,
  memo: null,
  swimmer_ids,
  lanes: null,
  status,
  created_at: 100,
  recorder_ids,
  deleted: false,
})
const timeRow = (session_id: string, swimmer_id: string, rep: number, centis: number | null): TimeRow => ({
  session_id,
  swimmer_id,
  rep,
  centis,
  deleted: false,
})

/** 管理者の端末で、選手2人・3本の測定を作ってクラウドと同期した状態にする */
async function linkedAdmin() {
  const a = await addSwimmer({ name: '山田' })
  const b = await addSwimmer({ name: '佐藤' })
  const s = await createSession({ date: '2026-11-20', distance: 50, reps: 3, swimmerIds: [a, b] })
  await uploadLocal()
  await syncOnce(remote, admin)
  return { a, b, s }
}

describe('初めての同期', () => {
  it('この端末が空なら、そのままクラウドの記録を受け取る', async () => {
    remote.serverWrite('swimmers', swimmerRow('w1', '山田'))
    remote.serverWrite('sessions', sessionRow('s1', ['w1']))
    remote.serverWrite('times', timeRow('s1', 'w1', 1, 3852))
    expect(await syncOnce(remote, { role: 'member', userId: 'm1' })).toEqual({ kind: 'synced', pushed: 0, rejected: 0 })
    expect(await isLinked()).toBe(true)
    expect((await listSwimmers()).map((s) => s.name)).toEqual(['山田'])
    expect(await listTimes('s1')).toEqual([{ sessionId: 's1', swimmerId: 'w1', rep: 1, centis: 3852 }])
  })

  it('この端末に記録があり、クラウドが空：入力担当には「載せる」選択肢', async () => {
    await addSwimmer({ name: '山田' })
    const r = await syncOnce(remote, admin)
    expect(r).toEqual({
      kind: 'needsChoice',
      choice: { localCounts: { swimmers: 1, sessions: 0, times: 0 }, cloudHasData: false, canUpload: true },
    })
    expect(await isLinked()).toBe(false)
    // 管理者でなければ載せられない
    const m = await syncOnce(remote, { role: 'member', userId: 'm1' })
    expect(m.kind === 'needsChoice' && m.choice.canUpload).toBe(false)
  })

  it('「載せる」を選ぶと、この端末の記録がすべてクラウドに入る', async () => {
    const { a, b, s } = await linkedAdmin()
    expect(remote.live('swimmers').map((r) => r.name).sort()).toEqual(['佐藤', '山田'])
    expect(remote.live('sessions').map((r) => [r.id, r.swimmer_ids])).toEqual([[s, [a, b]]])
    expect(await db.outbox.count()).toBe(0)
  })

  it('クラウドに記録があると「載せる」は選べない。「切り替える」で端末の記録はクラウドの記録になる', async () => {
    remote.serverWrite('swimmers', swimmerRow('w1', 'クラウドの選手'))
    await addSwimmer({ name: '端末だけの選手' })
    const r = await syncOnce(remote, admin)
    expect(r.kind === 'needsChoice' && r.choice).toMatchObject({ cloudHasData: true, canUpload: false })
    await adoptCloud()
    await syncOnce(remote, admin)
    expect((await listSwimmers()).map((s) => s.name)).toEqual(['クラウドの選手'])
    // 端末だけの選手はクラウドに送られていない
    expect(remote.live('swimmers').map((r) => r.name)).toEqual(['クラウドの選手'])
  })

  it('承認待ちの人は同期できない', async () => {
    await expect(syncOnce(remote, { role: 'pending', userId: 'x' })).rejects.toThrow('承認')
  })
})

describe('管理者の端末', () => {
  it('入力・修正・休み・消去・測定終了が、そのままクラウドに届く', async () => {
    const { a, b, s } = await linkedAdmin()
    await saveCell(s, a, 1, 3852)
    await saveCell(s, b, 1, null)
    await saveCell(s, a, 2, 3900)
    await saveCell(s, a, 2, 3890)
    await saveCell(s, a, 3, 4000)
    await saveCell(s, a, 3, undefined)
    await finishSession(s)
    await updateSwimmer(a, { name: '山田 太郎', grade: '2年' })
    // 同じマスを何度変えても、送信待ちは1件
    expect(await db.outbox.count()).toBe(6)
    const r = await syncOnce(remote, admin)
    expect(r).toMatchObject({ kind: 'synced', pushed: 6, rejected: 0 })
    expect(remote.live('times').map((t) => [t.swimmer_id === a ? 'a' : 'b', t.rep, t.centis]).sort()).toEqual([
      ['a', 1, 3852],
      ['a', 2, 3890],
      ['b', 1, null],
    ])
    expect(remote.live('sessions')[0].status).toBe('finished')
    expect(remote.tables.swimmers.get(`swimmers:${a}`)).toMatchObject({ name: '山田 太郎', grade: '2年' })
    expect(await db.outbox.count()).toBe(0)
  })

  it('ほかの端末の変更を受け取る（追加・修正・削除）', async () => {
    const { a, s } = await linkedAdmin()
    remote.serverWrite('times', timeRow(s, a, 1, 3700))
    remote.serverWrite('swimmers', swimmerRow('w9', '新入部員', Date.now() + 1e9))
    await syncOnce(remote, admin)
    expect((await listTimes(s)).map((t) => t.centis)).toEqual([3700])
    expect((await listSwimmers()).map((x) => x.name)).toEqual(['山田', '佐藤', '新入部員'])

    remote.serverWrite('times', { ...timeRow(s, a, 1, 3700), deleted: true })
    remote.serverWrite('swimmers', { ...swimmerRow('w9', '新入部員', Date.now() + 1e9), deleted: true })
    await syncOnce(remote, admin)
    expect(await listTimes(s)).toEqual([])
    expect((await listSwimmers()).map((x) => x.name)).toEqual(['山田', '佐藤'])
  })

  it('まだ送っていない変更は、受け取ったクラウドの内容で上書きされない（後から送った方が残る）', async () => {
    const { a, s } = await linkedAdmin()
    remote.serverWrite('times', timeRow(s, a, 1, 3700)) // ほかの端末が先に入力
    await saveCell(s, a, 1, 3852) // この端末でも入力（まだ送っていない）
    // 送る前に受け取るだけの状況でも、端末の入力は残る
    remote.failNext = 1
    await expect(syncOnce(remote, admin)).rejects.toThrow()
    expect((await listTimes(s))[0].centis).toBe(3852)
    // 次の同期で送られ、クラウドもこの端末の値になる
    await syncOnce(remote, admin)
    expect(remote.live('times')[0].centis).toBe(3852)
    expect((await listTimes(s))[0].centis).toBe(3852)
  })

  it('測定を削除すると、測定とタイムに削除の印が付き、ほかの端末からも消える', async () => {
    const { a, b, s } = await linkedAdmin()
    await saveCell(s, a, 1, 3852)
    await saveCell(s, b, 1, 4000)
    await syncOnce(remote, admin)
    await deleteSession(s)
    await syncOnce(remote, admin)
    expect(remote.live('sessions')).toEqual([])
    expect(remote.live('times')).toEqual([])

    // ほかの端末：削除を受け取ると、測定もタイムも消える
    await db.delete()
    await db.open()
    remote.as = { role: 'admin', userId: 'admin' }
    remote.serverWrite('sessions', sessionRow('s2', [a]))
    remote.serverWrite('times', timeRow('s2', a, 1, 3800))
    await syncOnce(remote, admin)
    expect(await listTimes('s2')).toHaveLength(1)
    remote.serverWrite('sessions', { ...sessionRow('s2', [a]), deleted: true })
    await syncOnce(remote, admin)
    expect(await db.sessions.get('s2')).toBeUndefined()
    expect(await listTimes('s2')).toEqual([])
  })

  it('電波が切れて送れなくても、送信待ちは残り、次の同期で送られる', async () => {
    const { a, s } = await linkedAdmin()
    await saveCell(s, a, 1, 3852)
    remote.failNext = 1
    await expect(syncOnce(remote, admin)).rejects.toThrow('Failed to fetch')
    expect(await db.outbox.count()).toBe(1)
    await syncOnce(remote, admin)
    expect(await db.outbox.count()).toBe(0)
    expect(remote.live('times')[0].centis).toBe(3852)
  })

  it('送っている間にまた変えた行は、送信待ちに残る', async () => {
    const { a, s } = await linkedAdmin()
    await saveCell(s, a, 1, 3852)
    // 送る処理の途中（クラウドに届いた直後）で、同じマスをまた変える
    const original = remote.upsert.bind(remote)
    remote.upsert = async (table, rows) => {
      await original(table, rows)
      if (table === 'times') await saveCell(s, a, 1, 3800)
    }
    await syncOnce(remote, admin)
    remote.upsert = original
    expect(await db.outbox.count()).toBe(1)
    await syncOnce(remote, admin)
    expect(remote.live('times')[0].centis).toBe(3800)
  })

  it('受け取る行が多くても、すべて受け取る（何回かに分けて）', async () => {
    remote.serverWrite('swimmers', swimmerRow('w1', '山田'))
    remote.serverWrite('sessions', sessionRow('s1', ['w1'], 100))
    const n = PAGE_SIZE + 5
    for (let i = 0; i < n; i++) {
      // 100本ずつ、別の測定に入れる
      const sid = `s${Math.floor(i / 100) + 1}`
      if (i % 100 === 0 && i > 0) remote.serverWrite('sessions', sessionRow(sid, ['w1'], 100))
      remote.serverWrite('times', timeRow(sid, 'w1', (i % 100) + 1, 3000 + i))
    }
    await syncOnce(remote, admin)
    expect(await db.times.count()).toBe(n)
    expect(remote.calls.filter((c) => c === 'fetch times').length).toBeGreaterThan(1)
  })
})

describe('記録係・部員の端末', () => {
  const REC = 'user-recorder'
  const OTHER = 'user-other'

  /** 管理者が作ったクラウドの記録（入力中の s1 の記録係は REC、終了済みの s0 も記録係は REC）を、部員の端末で受け取る */
  async function linkedAs(userId: string) {
    remote.as = { role: 'admin', userId: 'admin' }
    remote.serverWrite('swimmers', swimmerRow('yamada', '山田', 1))
    remote.serverWrite('swimmers', swimmerRow('sato', '佐藤', 2))
    remote.serverWrite('sessions', sessionRow('s0', ['yamada', 'sato'], 3, [REC], 'finished'))
    remote.serverWrite('times', timeRow('s0', 'yamada', 1, 3800))
    remote.serverWrite('sessions', sessionRow('s1', ['yamada', 'sato'], 3, [REC]))
    remote.serverWrite('times', timeRow('s1', 'sato', 1, 4000))
    remote.as = { role: 'member', userId }
    const ctx: SyncContext = { role: 'member', userId }
    await syncOnce(remote, ctx)
    return ctx
  }

  it('記録係は、担当の入力中の測定に全員分のタイムを入力・修正・消去できる', async () => {
    const ctx = await linkedAs(REC)
    expect((await db.sessions.get('s1'))!.recorderIds).toEqual([REC])
    await saveCell('s1', 'yamada', 1, 3852)
    await saveCell('s1', 'sato', 1, 4010)
    await saveCell('s1', 'sato', 2, null)
    await saveCell('s1', 'sato', 2, undefined)
    expect(await syncOnce(remote, ctx)).toMatchObject({ pushed: 3, rejected: 0 })
    expect(remote.live('times').filter((t) => t.session_id === 's1').map((t) => [t.swimmer_id, t.rep, t.centis]).sort()).toEqual([
      ['sato', 1, 4010],
      ['yamada', 1, 3852],
    ])
  })

  it('記録係が測定情報を直すと、上書きで送られる（記録係は測定を新しく作れないため）', async () => {
    const ctx = await linkedAs(REC)
    const s = (await db.sessions.get('s1'))!
    await db.transaction('rw', db.sessions, db.outbox, async () => {
      await db.sessions.put({ ...s, memo: '雨' })
      await (await import('./outbox')).track({ table: 'sessions', id: 's1' })
    })
    expect(await syncOnce(remote, ctx)).toMatchObject({ pushed: 1, rejected: 0 })
    expect(remote.tables.sessions.get('sessions:s1')!.memo).toBe('雨')
    expect(remote.calls).toContain('update sessions ×1')
  })

  it('記録係がタイムを入れてすぐ終了しても、タイムが先に届いてから終了になる', async () => {
    const ctx = await linkedAs(REC)
    await saveCell('s1', 'yamada', 1, 3852)
    await saveCell('s1', 'yamada', 2, 3900)
    await finishSession('s1')
    expect(await syncOnce(remote, ctx)).toMatchObject({ pushed: 3, rejected: 0 })
    expect(remote.tables.sessions.get('sessions:s1')!.status).toBe('finished')
    expect(remote.live('times').filter((t) => t.swimmer_id === 'yamada' && t.session_id === 's1')).toHaveLength(2)
  })

  it('終了した測定のタイムは、記録係でも送れず、元に戻る', async () => {
    const ctx = await linkedAs(REC)
    await saveCell('s0', 'yamada', 1, 3700)
    expect(await syncOnce(remote, ctx)).toMatchObject({ pushed: 0, rejected: 1 })
    expect(remote.tables.times.get('times:s0:yamada:1')!.centis).toBe(3800)
    expect((await listTimes('s0'))[0].centis).toBe(3800)
  })

  it('記録係でも、測定の作成・削除は送れず、元に戻る', async () => {
    const ctx = await linkedAs(REC)
    const created = await createSession({ date: '2026-11-21', distance: 50, reps: 2, swimmerIds: ['yamada'] })
    await deleteSession('s1')
    const r = await syncOnce(remote, ctx)
    expect(r.kind === 'synced' && r.rejected).toBeGreaterThan(0)
    expect(remote.tables.sessions.has(`sessions:${created}`)).toBe(false)
    expect(remote.live('sessions').map((s) => s.id).sort()).toEqual(['s0', 's1'])
    // 端末も元に戻る（作った測定は消え、消した測定とタイムは戻る）
    expect(await db.sessions.get(created)).toBeUndefined()
    expect(await db.sessions.get('s1')).toBeDefined()
    expect(await listTimes('s1')).toHaveLength(1)
  })

  it('記録係に指名されていない部員の変更は、送れずに元に戻る', async () => {
    const ctx = await linkedAs(OTHER)
    await saveCell('s1', 'yamada', 1, 3000)
    await saveCell('s1', 'sato', 1, 3000)
    await updateSwimmer('sato', { name: '佐藤（勝手に変更）' })
    const r = await syncOnce(remote, ctx)
    expect(r).toMatchObject({ pushed: 0, rejected: 3 })
    expect(remote.tables.times.has('times:s1:yamada:1')).toBe(false)
    expect((await listTimes('s1')).map((t) => [t.swimmerId, t.centis])).toEqual([['sato', 4000]])
    expect((await listSwimmers()).map((s) => s.name)).toEqual(['山田', '佐藤'])
    expect(await db.outbox.count()).toBe(0)
  })

  it('入力中の測定の記録係は、選手を登録できる', async () => {
    const ctx = await linkedAs(REC)
    await addSwimmer({ name: '新入部員' })
    expect(await syncOnce(remote, ctx)).toMatchObject({ pushed: 1, rejected: 0 })
    expect(remote.live('swimmers').map((s) => s.name)).toContain('新入部員')
  })

  it('記録係を外されると、次の同期からは送れない', async () => {
    const ctx = await linkedAs(REC)
    remote.as = { role: 'admin', userId: 'admin' }
    remote.serverWrite('sessions', sessionRow('s1', ['yamada', 'sato'], 3, []))
    remote.as = { role: 'member', userId: REC }
    await syncOnce(remote, ctx)
    expect((await db.sessions.get('s1'))!.recorderIds).toBeUndefined()
    await saveCell('s1', 'yamada', 1, 3852)
    expect(await syncOnce(remote, ctx)).toMatchObject({ pushed: 0, rejected: 1 })
    expect(await listTimes('s1')).toHaveLength(1)
  })
})
