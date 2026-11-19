import type { Role } from '../cloud/members'
import type { SyncRef, SyncTable } from '../db'
import { refKey } from './outbox'
import {
  refOfRow,
  RemoteError,
  type AnyRow,
  type Remote,
  type RowOf,
  type SessionRow,
  type TimeRow,
} from './remote'

/**
 * テスト用のクラウドの代わり（手元の入れ物）。
 * 本物（supabase/migrations/0002_recorders.sql）と同じように、
 *  - 更新日時はクラウド側で付ける
 *  - 管理者はすべて書ける。測定を作れるのは管理者だけ（「上書きまたは追加」は追加のルールにも当たる）
 *  - 部員は、記録係に指名された入力中の測定だけ書ける（タイム・測定の上書き・選手）
 *  - 記録係は、記録係の指名と測定の削除を変えられない
 *  - タイムは、クラウドにある選手・測定を指し、測定の参加者・本数の範囲内であること
 *  - 許されない削除の印は、何も起きない（本物の行ごとのアクセス制御と同じ）
 */
export class FakeRemote implements Remote {
  tables: { [T in SyncTable]: Map<string, RowOf[T]> } = { swimmers: new Map(), sessions: new Map(), times: new Map() }
  /** 今ログインしている人 */
  as: { role: Role; userId: string } = { role: 'admin', userId: 'admin' }
  /** 次の n 回のやり取りを、電波が切れたときと同じように失敗させる */
  failNext = 0
  /** やり取りの記録（テストで確かめる用） */
  calls: string[] = []
  private clock = Date.parse('2026-11-20T00:00:00.000Z')

  private tick(): string {
    this.clock += 1
    return new Date(this.clock).toISOString()
  }

  private maybeFail(name: string) {
    this.calls.push(name)
    if (this.failNext > 0) {
      this.failNext--
      throw new RemoteError('network', 'Failed to fetch')
    }
  }

  private key(table: SyncTable, row: AnyRow) {
    return refKey(refOfRow(table, row))
  }

  /** 別の端末（管理者など）がクラウドを変えたことにする */
  serverWrite<T extends SyncTable>(table: T, row: RowOf[T]) {
    const stored = { ...row, updated_at: this.tick() }
    ;(this.tables[table] as Map<string, RowOf[T]>).set(this.key(table, row), stored)
  }

  private get admin() {
    return this.as.role === 'admin'
  }

  private session(id: string) {
    return this.tables.sessions.get(`sessions:${id}`) as SessionRow | undefined
  }

  /** 入力中のこの測定の記録係か */
  private isOpenRecorder(s: SessionRow | undefined) {
    return this.as.role === 'member' && !!s && !s.deleted && s.status === 'in_progress' && s.recorder_ids.includes(this.as.userId)
  }

  private canWriteTime(t: TimeRow) {
    const s = this.session(t.session_id)
    if (!s || !s.swimmer_ids.includes(t.swimmer_id) || t.rep > s.reps) return false
    return this.admin || this.isOpenRecorder(s)
  }

  private isActiveRecorder() {
    return [...this.tables.sessions.values()].some((s) => this.isOpenRecorder(s))
  }

  private deny(): never {
    throw new RemoteError('permission', 'new row violates row-level security policy')
  }

  /** 書き込みのルール（本物の RLS とトリガー）。mode = 'insert' は「上書きまたは追加」の追加側のチェック */
  private check(table: SyncTable, row: AnyRow, mode: 'insert' | 'update') {
    if (table === 'times') {
      const t = row as TimeRow
      if (!this.tables.sessions.has(`sessions:${t.session_id}`) || !this.tables.swimmers.has(`swimmers:${t.swimmer_id}`)) {
        throw new RemoteError('other', 'violates foreign key constraint')
      }
      if (!this.canWriteTime(t)) this.deny()
    } else if (table === 'swimmers') {
      if (!this.admin && !this.isActiveRecorder()) this.deny()
    } else {
      const next = row as SessionRow
      const cur = this.session(next.id)
      if (mode === 'insert' && !this.admin) this.deny()
      if (mode === 'update' && !this.admin) {
        if (!cur || !this.isOpenRecorder(cur)) this.deny()
        if (cur.recorder_ids.join() !== next.recorder_ids.join() || cur.deleted !== next.deleted) this.deny()
      }
    }
  }

  async hasAnyData() {
    this.maybeFail('hasAnyData')
    return [...this.tables.swimmers.values(), ...this.tables.sessions.values()].some((r) => !r.deleted)
  }

  async fetchChanges<T extends SyncTable>(table: T, after: string | null, limit: number): Promise<RowOf[T][]> {
    this.maybeFail(`fetch ${table}`)
    return [...(this.tables[table] as Map<string, RowOf[T]>).values()]
      .filter((r) => after == null || Date.parse(r.updated_at!) > Date.parse(after))
      .sort((a, b) => Date.parse(a.updated_at!) - Date.parse(b.updated_at!))
      .slice(0, limit)
      .map((r) => ({ ...r }))
  }

  async upsert<T extends SyncTable>(table: T, rows: RowOf[T][]): Promise<void> {
    this.maybeFail(`upsert ${table} ×${rows.length}`)
    // 1件でもルールに反すれば、まとめて断る（本物と同じ）
    for (const row of rows) {
      this.check(table, row, 'insert')
      if (this.tables[table].has(this.key(table, row))) this.check(table, row, 'update')
    }
    for (const row of rows) this.serverWrite(table, { ...row, deleted: false })
  }

  async update<T extends SyncTable>(table: T, rows: RowOf[T][]): Promise<void> {
    this.maybeFail(`update ${table} ×${rows.length}`)
    for (const row of rows) {
      if (!this.tables[table].has(this.key(table, row))) this.deny()
      this.check(table, row, 'update')
      this.serverWrite(table, row)
    }
  }

  async markDeleted(refs: SyncRef[]): Promise<void> {
    this.maybeFail(`markDeleted ×${refs.length}`)
    for (const ref of refs) {
      const map = this.tables[ref.table] as Map<string, AnyRow>
      const row = map.get(refKey(ref))
      if (!row) continue
      try {
        this.check(ref.table, { ...row, deleted: true } as AnyRow, 'update')
      } catch {
        continue // 許されない削除は、何も起きない
      }
      this.serverWrite(ref.table, { ...row, deleted: true } as never)
    }
  }

  async fetchRows(refs: SyncRef[]) {
    this.maybeFail(`fetchRows ×${refs.length}`)
    return refs.map((ref) => ({ ref, row: ((this.tables[ref.table] as Map<string, AnyRow>).get(refKey(ref)) ?? null) as AnyRow | null }))
  }

  /** 削除されていない行（テストで確かめる用） */
  live<T extends SyncTable>(table: T): RowOf[T][] {
    return [...(this.tables[table] as Map<string, RowOf[T]>).values()].filter((r) => !r.deleted)
  }
}
