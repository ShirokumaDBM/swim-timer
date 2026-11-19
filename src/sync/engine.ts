import type { Role } from '../cloud/members'
import { db, type OutboxEntry, type SyncRef, type SyncTable } from '../db'
import type { Id, Session } from '../domain/types'
import { refKey, sessionRef, swimmerRef, timeRef, track } from './outbox'
import {
  refOfRow,
  RemoteError,
  sessionFromRow,
  sessionToRow,
  swimmerFromRow,
  swimmerToRow,
  timeFromRow,
  timeToRow,
  type AnyRow,
  type Remote,
  type RowOf,
  type SessionRow,
  type SwimmerRow,
  type TimeRow,
} from './remote'

/**
 * クラウドとの同期の手順。
 *
 * - 端末の変更は送信待ち（db.outbox）にたまっている。送るときは、その時点の端末の内容を送る（無ければ削除の印）
 * - クラウドの変更は「前回受け取った時刻より後に変わった行」を受け取る
 * - 送信待ちの行は、クラウドの内容で上書きしない（端末の変更を先に送る。同じマスは後から送った方が残る）
 * - 管理者はすべて送れる。部員は、記録係に指名された入力中の測定の変更だけ送れる。
 *   送れない変更は送らずに取り消し、クラウドの内容に戻す（最終的な判断はクラウドのルール）
 */

export interface SyncContext {
  role: Role
  /** ログインしている人（記録係かどうかの判断に使う） */
  userId: string
}

const TABLES: SyncTable[] = ['swimmers', 'sessions', 'times']
const LINK_KEY = 'cloud:linked'
const cursorKey = (table: SyncTable) => `cloud:cursor:${table}`

/** 1回に受け取る行の数（Supabase が1回に返せる上限に合わせる） */
export const PAGE_SIZE = 1000
/** 1回に送る行の数 */
export const PUSH_CHUNK = 500
/** 受け取りを少し前からやり直す幅。ほぼ同時に保存された行の取りこぼしを防ぐ */
const OVERLAP_MS = 5000

export const isAdmin = (role: Role) => role === 'admin'
export const isApproved = (role: Role) => role === 'member' || role === 'admin'

export interface LocalCounts {
  swimmers: number
  sessions: number
  times: number
}

/** 初めて同期するとき、この端末にもともと記録があった場合の選択肢 */
export interface LinkChoice {
  localCounts: LocalCounts
  /** クラウドにすでに部の記録があるか */
  cloudHasData: boolean
  /** この端末の記録をクラウドに載せられるか（管理者で、クラウドが空のとき） */
  canUpload: boolean
}

export type SyncOutcome =
  | { kind: 'needsChoice'; choice: LinkChoice }
  | { kind: 'synced'; pushed: number; rejected: number }

/** この端末がクラウドと同期しているか */
export async function isLinked(): Promise<boolean> {
  return (await db.meta.get(LINK_KEY))?.value === true
}

export async function localCounts(): Promise<LocalCounts> {
  const [swimmers, sessions, times] = await Promise.all([db.swimmers.count(), db.sessions.count(), db.times.count()])
  return { swimmers, sessions, times }
}

async function markLinked() {
  await db.meta.bulkDelete(TABLES.map(cursorKey))
  await db.meta.put({ key: LINK_KEY, value: true })
}

/** この端末の記録をすべてクラウドに載せる準備をする（次の同期で送られる） */
export async function uploadLocal(): Promise<void> {
  await db.transaction('rw', [db.swimmers, db.sessions, db.times, db.outbox, db.meta], async () => {
    const [swimmers, sessions, times] = await Promise.all([db.swimmers.toArray(), db.sessions.toArray(), db.times.toArray()])
    await db.outbox.clear()
    await track(
      ...swimmers.map((s) => swimmerRef(s.id)),
      ...sessions.map((s) => sessionRef(s.id)),
      ...times.map(timeRef),
    )
    await markLinked()
  })
}

/** この端末の記録を消して、クラウドの記録に切り替える（次の同期で受け取る） */
export async function adoptCloud(): Promise<void> {
  await db.transaction('rw', [db.swimmers, db.sessions, db.times, db.outbox, db.meta], async () => {
    await Promise.all([db.swimmers.clear(), db.sessions.clear(), db.times.clear(), db.outbox.clear()])
    await markLinked()
  })
}

/** 1回同期する（送ってから受け取る） */
export async function syncOnce(remote: Remote, ctx: SyncContext): Promise<SyncOutcome> {
  if (!isApproved(ctx.role)) throw new Error('承認されていないため、同期できません。')
  if (!(await isLinked())) {
    const counts = await localCounts()
    if (counts.swimmers + counts.sessions > 0) {
      const cloudHasData = await remote.hasAnyData()
      return { kind: 'needsChoice', choice: { localCounts: counts, cloudHasData, canUpload: isAdmin(ctx.role) && !cloudHasData } }
    }
    // この端末は空なので、そのままクラウドの記録を受け取る
    await adoptCloud()
  }
  const result = await push(remote, ctx)
  await pull(remote)
  return { kind: 'synced', ...result }
}

// ---------- 送る ----------

/**
 * 送ってよい変更か。管理者はすべて。部員は記録係に指名された測定の変更だけ（端末の記録で判断する）。
 * 測定の状態（入力中かどうか）はクラウドのルールで判断する（端末では、この人が終了させた直後のこともあるため）
 */
function mayPush(entry: OutboxEntry, ctx: SyncContext, sessions: Map<Id, Session>): boolean {
  if (isAdmin(ctx.role)) return true
  const isRecorderOf = (id: Id) => !!sessions.get(id)?.recorderIds?.includes(ctx.userId)
  const ref = entry.ref
  switch (ref.table) {
    case 'times':
      return isRecorderOf(ref.sessionId)
    case 'sessions':
      // 測定の削除は管理者だけ（端末に無い＝削除された測定は送らない）
      return sessions.has(ref.id) && isRecorderOf(ref.id)
    case 'swimmers':
      // 入力中の測定の記録係の間は、選手を登録・修正できる
      return [...sessions.values()].some((s) => s.status === 'in_progress' && s.recorderIds?.includes(ctx.userId))
  }
}

type Live = { entry: OutboxEntry; row: RowOf[SyncTable] }

/** 送信待ちを、その時点の端末の内容（あれば上書き、無ければ削除の印）に分ける */
async function resolve(table: SyncTable, entries: OutboxEntry[]): Promise<{ live: Live[]; gone: OutboxEntry[] }> {
  const live: Live[] = []
  const gone: OutboxEntry[] = []
  if (table === 'times') {
    const keys = entries.map((e) => {
      const r = e.ref as Extract<SyncRef, { table: 'times' }>
      return [r.sessionId, r.swimmerId, r.rep] as [Id, Id, number]
    })
    const found = await db.times.bulkGet(keys)
    entries.forEach((entry, i) => (found[i] ? live.push({ entry, row: timeToRow(found[i]) }) : gone.push(entry)))
  } else {
    const ids = entries.map((e) => (e.ref as { id: Id }).id)
    const found = table === 'swimmers' ? await db.swimmers.bulkGet(ids) : await db.sessions.bulkGet(ids)
    entries.forEach((entry, i) => {
      const item = found[i]
      if (!item) gone.push(entry)
      else live.push({ entry, row: table === 'swimmers' ? swimmerToRow(item as never) : sessionToRow(item as never) })
    })
  }
  return { live, gone }
}

async function push(remote: Remote, ctx: SyncContext): Promise<{ pushed: number; rejected: number }> {
  const entries = await db.outbox.orderBy('seq').toArray()
  if (entries.length === 0) return { pushed: 0, rejected: 0 }
  const sessions = new Map((await db.sessions.toArray()).map((s) => [s.id, s]))
  const done: OutboxEntry[] = []
  const rejected: OutboxEntry[] = entries.filter((e) => !mayPush(e, ctx, sessions))
  const allowed = entries.filter((e) => mayPush(e, ctx, sessions))
  const admin = isAdmin(ctx.role)
  const of = (table: SyncTable) => allowed.filter((e) => e.ref.table === table)

  // 送る順番。タイムは選手・測定を指しているので、選手 → 測定 → タイムが基本。
  // 記録係は「入力中の測定 → タイム → 終了した測定」にする。
  // 測定の終了を先に送ると、その前に入れたタイムがクラウドに断られるため
  const isOpen = (e: OutboxEntry) => sessions.get((e.ref as { id: Id }).id)?.status === 'in_progress'
  const groups: [SyncTable, OutboxEntry[]][] = admin
    ? TABLES.map((t) => [t, of(t)])
    : [
        ['swimmers', of('swimmers')],
        ['sessions', of('sessions').filter(isOpen)],
        ['times', of('times')],
        ['sessions', of('sessions').filter((e) => !isOpen(e))],
      ]
  // 管理者以外は、測定を新しく作れない（「上書きまたは追加」は追加のルールにも当たる）ので、上書きだけを使う
  const send = (table: SyncTable, rows: RowOf[SyncTable][]) =>
    table === 'sessions' && !admin ? remote.update(table, rows as never) : remote.upsert(table, rows as never)

  try {
    for (const [table, group] of groups) {
      const { live, gone } = await resolve(table, group)
      for (let i = 0; i < live.length; i += PUSH_CHUNK) {
        const chunk = live.slice(i, i + PUSH_CHUNK)
        try {
          await send(
            table,
            chunk.map((x) => x.row),
          )
          done.push(...chunk.map((x) => x.entry))
        } catch (err) {
          if (!(err instanceof RemoteError && err.kind === 'permission')) throw err
          // まとめて断られたら1件ずつ送り直し、断られた行だけを取り消す
          for (const x of chunk) {
            try {
              await send(table, [x.row])
              done.push(x.entry)
            } catch (err2) {
              if (err2 instanceof RemoteError && err2.kind === 'permission') rejected.push(x.entry)
              else throw err2
            }
          }
        }
      }
      if (gone.length > 0) {
        await remote.markDeleted(gone.map((e) => e.ref))
        done.push(...gone)
      }
    }
  } finally {
    // 途中で電波が切れても、送れた分は送信待ちから外す（残りは次の同期で送る）
    await finish(done)
  }
  if (rejected.length > 0) await restore(remote, rejected)
  return { pushed: done.length, rejected: rejected.length }
}

/** 送れた行を送信待ちから外す。送っている間にまた変えられた行は残す */
async function finish(entries: OutboxEntry[]) {
  if (entries.length === 0) return
  await db.transaction('rw', db.outbox, async () => {
    const current = await db.outbox.bulkGet(entries.map((e) => e.key))
    const unchanged = entries.filter((e, i) => current[i]?.seq === e.seq).map((e) => e.key)
    await db.outbox.bulkDelete(unchanged)
  })
}

/** 送れなかった変更を取り消し、クラウドの内容に戻す */
async function restore(remote: Remote, entries: OutboxEntry[]) {
  const rows = await remote.fetchRows(entries.map((e) => e.ref))
  await db.transaction('rw', [db.swimmers, db.sessions, db.times, db.outbox], async () => {
    const current = await db.outbox.bulkGet(entries.map((e) => e.key))
    const stillSame = new Set(entries.filter((e, i) => current[i]?.seq === e.seq).map((e) => e.key))
    for (const { ref, row } of rows) {
      const key = refKey(ref)
      if (!stillSame.has(key)) continue
      await applyOne(ref, row)
      await db.outbox.delete(key)
    }
  })
}

// ---------- 受け取る ----------

async function pull(remote: Remote): Promise<void> {
  for (const table of TABLES) {
    const cursor = (await db.meta.get(cursorKey(table)))?.value as string | undefined
    let after = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : null
    let newest = cursor ?? null
    for (;;) {
      const rows = await remote.fetchChanges(table, after, PAGE_SIZE)
      if (rows.length === 0) break
      await applyRows(table, rows)
      const last = rows[rows.length - 1].updated_at!
      if (newest == null || Date.parse(last) >= Date.parse(newest)) newest = last
      after = last
      if (rows.length < PAGE_SIZE) break
    }
    if (newest) await db.meta.put({ key: cursorKey(table), value: newest })
  }
}

async function applyRows(table: SyncTable, rows: AnyRow[]) {
  await db.transaction('rw', [db.swimmers, db.sessions, db.times, db.outbox], async () => {
    const refs = rows.map((r) => refOfRow(table, r))
    const pending = await db.outbox.bulkGet(refs.map(refKey))
    for (let i = 0; i < rows.length; i++) {
      // この端末でまだ送っていない変更がある行は、上書きしない（次の同期で端末の内容を送る）
      if (pending[i]) continue
      await applyOne(refs[i], rows[i])
    }
  })
}

/** クラウドの1行を端末に反映する（row = null や削除の印なら、端末からも消す） */
async function applyOne(ref: SyncRef, row: AnyRow | null) {
  const removed = row == null || row.deleted
  switch (ref.table) {
    case 'swimmers':
      if (removed) await db.swimmers.delete(ref.id)
      else await db.swimmers.put(swimmerFromRow(row as SwimmerRow))
      break
    case 'sessions':
      if (removed) {
        // 測定が消されたら、その測定のタイムも消す（送信待ちのものも、もう送れないので外す）
        const times = await db.times.where('sessionId').equals(ref.id).toArray()
        await db.times.where('sessionId').equals(ref.id).delete()
        await db.outbox.bulkDelete(times.map((t) => refKey(timeRef(t))))
        await db.sessions.delete(ref.id)
      } else {
        await db.sessions.put(sessionFromRow(row as SessionRow))
      }
      break
    case 'times':
      if (removed) await db.times.delete([ref.sessionId, ref.swimmerId, ref.rep])
      // 測定は先に受け取っているので、端末に無い測定（消された測定）のタイムは取り込まない
      else if (await db.sessions.get(ref.sessionId)) await db.times.put(timeFromRow(row as TimeRow))
      break
  }
}
