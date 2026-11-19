import type { SupabaseClient } from '@supabase/supabase-js'
import type { SyncRef, SyncTable } from '../db'
import { refKey } from './outbox'
import { refOfRow, RemoteError, type AnyRow, type Remote, type RowOf, type TimeRow } from './remote'

interface PgError {
  message: string
  code?: string
}

/** Supabase の失敗を、同期の手順が見分けられる形にする */
function toRemoteError(error: PgError, status: number): RemoteError {
  // 0 = サーバーまで届かなかった（電波がない・つながらない）
  if (status === 0 || /failed to fetch|networkerror|fetch failed|load failed/i.test(error.message)) {
    return new RemoteError('network', '通信できませんでした')
  }
  if (error.code === '42501' || /row-level security|permission denied/i.test(error.message)) {
    return new RemoteError('permission', error.message)
  }
  return new RemoteError('other', error.message)
}

async function run<T>(q: PromiseLike<{ data: T | null; error: PgError | null; status: number }>): Promise<T> {
  let result
  try {
    result = await q
  } catch (err) {
    throw new RemoteError('network', err instanceof Error ? err.message : String(err))
  }
  if (result.error) throw toRemoteError(result.error, result.status)
  return result.data as T
}

const CONFLICT: Record<SyncTable, string> = {
  swimmers: 'id',
  sessions: 'id',
  times: 'session_id,swimmer_id,rep',
}

/** 本番のクラウド（Supabase）とのやり取り */
export class SupabaseRemote implements Remote {
  private readonly sb: SupabaseClient

  constructor(sb: SupabaseClient) {
    this.sb = sb
  }

  async hasAnyData(): Promise<boolean> {
    const [swimmers, sessions] = await Promise.all([
      run(this.sb.from('swimmers').select('id').eq('deleted', false).limit(1)),
      run(this.sb.from('sessions').select('id').eq('deleted', false).limit(1)),
    ])
    return (swimmers?.length ?? 0) + (sessions?.length ?? 0) > 0
  }

  async fetchChanges<T extends SyncTable>(table: T, after: string | null, limit: number): Promise<RowOf[T][]> {
    let q = this.sb.from(table).select('*').order('updated_at', { ascending: true }).limit(limit)
    if (after) q = q.gt('updated_at', after)
    return (await run(q)) as RowOf[T][]
  }

  async upsert<T extends SyncTable>(table: T, rows: RowOf[T][]): Promise<void> {
    if (rows.length === 0) return
    await run(this.sb.from(table).upsert(rows, { onConflict: CONFLICT[table] }))
  }

  async update<T extends SyncTable>(table: T, rows: RowOf[T][]): Promise<void> {
    for (const row of rows) {
      let q = this.sb.from(table).update(row)
      if (table === 'times') {
        const t = row as TimeRow
        q = q.eq('session_id', t.session_id).eq('swimmer_id', t.swimmer_id).eq('rep', t.rep)
      } else {
        q = q.eq('id', (row as { id: string }).id)
      }
      // 変わった行を返してもらい、0件（無い行・許されない行）なら断られたとみなす
      const changed = (await run(q.select())) as unknown[] | null
      if (!changed?.length) throw new RemoteError('permission', '上書きできる行がありません')
    }
  }

  async markDeleted(refs: SyncRef[]): Promise<void> {
    for (const table of ['swimmers', 'sessions'] as const) {
      const ids = refs.filter((r) => r.table === table).map((r) => (r as { id: string }).id)
      if (ids.length > 0) await run(this.sb.from(table).update({ deleted: true }).in('id', ids))
    }
    // タイムは「測定・選手」ごとにまとめて送る
    const groups = new Map<string, { sessionId: string; swimmerId: string; reps: number[] }>()
    for (const r of refs) {
      if (r.table !== 'times') continue
      const k = `${r.sessionId}:${r.swimmerId}`
      const g = groups.get(k) ?? { sessionId: r.sessionId, swimmerId: r.swimmerId, reps: [] }
      g.reps.push(r.rep)
      groups.set(k, g)
    }
    for (const g of groups.values()) {
      await run(
        this.sb
          .from('times')
          .update({ deleted: true })
          .eq('session_id', g.sessionId)
          .eq('swimmer_id', g.swimmerId)
          .in('rep', g.reps),
      )
    }
  }

  async fetchRows(refs: SyncRef[]): Promise<{ ref: SyncRef; row: AnyRow | null }[]> {
    const found = new Map<string, AnyRow>()
    for (const table of ['swimmers', 'sessions'] as const) {
      const ids = refs.filter((r) => r.table === table).map((r) => (r as { id: string }).id)
      if (ids.length === 0) continue
      const rows = (await run(this.sb.from(table).select('*').in('id', ids))) as AnyRow[]
      for (const row of rows) found.set(refKey(refOfRow(table, row)), row)
    }
    const sessionIds = [...new Set(refs.flatMap((r) => (r.table === 'times' ? [r.sessionId] : [])))]
    if (sessionIds.length > 0) {
      const rows = (await run(this.sb.from('times').select('*').in('session_id', sessionIds))) as TimeRow[]
      for (const row of rows) found.set(refKey(refOfRow('times', row)), row)
    }
    return refs.map((ref) => ({ ref, row: found.get(refKey(ref)) ?? null }))
  }
}
