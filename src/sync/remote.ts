import type { SyncRef, SyncTable } from '../db'
import type { Session, Swimmer, TimeRecord } from '../domain/types'

// ---------- クラウドの行の形（supabase/migrations/0001_init.sql の表と同じ） ----------

export interface SwimmerRow {
  id: string
  name: string
  grade: string | null
  created_at: number
  deleted: boolean
  updated_at?: string
}

export interface SessionRow {
  id: string
  date: string
  distance: number
  reps: number
  stroke: string | null
  circle: string | null
  memo: string | null
  swimmer_ids: string[]
  lanes: (number | null)[] | null
  status: Session['status']
  created_at: number
  /** 記録係（members.user_id） */
  recorder_ids: string[]
  deleted: boolean
  updated_at?: string
}

export interface TimeRow {
  session_id: string
  swimmer_id: string
  rep: number
  centis: number | null
  deleted: boolean
  updated_at?: string
}

export interface RowOf {
  swimmers: SwimmerRow
  sessions: SessionRow
  times: TimeRow
}

export type AnyRow = SwimmerRow | SessionRow | TimeRow

// ---------- 端末の形 ↔ クラウドの形 ----------

const opt = (v: string | null | undefined) => (v == null || v === '' ? undefined : v)

export function swimmerToRow(s: Swimmer): SwimmerRow {
  return { id: s.id, name: s.name, grade: s.grade ?? null, created_at: s.createdAt, deleted: false }
}

export function swimmerFromRow(r: SwimmerRow): Swimmer {
  return { id: r.id, name: r.name, ...(opt(r.grade) && { grade: r.grade! }), createdAt: Number(r.created_at) }
}

export function sessionToRow(s: Session): SessionRow {
  return {
    id: s.id,
    date: s.date,
    distance: s.distance,
    reps: s.reps,
    stroke: s.stroke ?? null,
    circle: s.circle ?? null,
    memo: s.memo ?? null,
    swimmer_ids: s.swimmerIds,
    lanes: s.lanes ?? null,
    status: s.status,
    created_at: s.createdAt,
    recorder_ids: s.recorderIds ?? [],
    deleted: false,
  }
}

export function sessionFromRow(r: SessionRow): Session {
  return {
    id: r.id,
    date: r.date,
    distance: r.distance,
    reps: r.reps,
    stroke: opt(r.stroke),
    circle: opt(r.circle),
    memo: opt(r.memo),
    swimmerIds: r.swimmer_ids,
    lanes: r.lanes?.some((l) => l != null) ? r.lanes : undefined,
    status: r.status,
    createdAt: Number(r.created_at),
    ...(r.recorder_ids?.length && { recorderIds: r.recorder_ids }),
  }
}

export function timeToRow(t: TimeRecord): TimeRow {
  return { session_id: t.sessionId, swimmer_id: t.swimmerId, rep: t.rep, centis: t.centis, deleted: false }
}

export function timeFromRow(r: TimeRow): TimeRecord {
  return { sessionId: r.session_id, swimmerId: r.swimmer_id, rep: r.rep, centis: r.centis }
}

/** クラウドの行が指す、端末の行 */
export function refOfRow(table: SyncTable, row: AnyRow): SyncRef {
  if (table === 'times') {
    const t = row as TimeRow
    return { table, sessionId: t.session_id, swimmerId: t.swimmer_id, rep: t.rep }
  }
  return { table, id: (row as SwimmerRow | SessionRow).id }
}

// ---------- クラウドとのやり取り ----------

export type RemoteErrorKind = 'permission' | 'network' | 'other'

export class RemoteError extends Error {
  readonly kind: RemoteErrorKind
  constructor(kind: RemoteErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

/**
 * クラウドとのやり取り。同期の手順（engine.ts）はこれだけを使う。
 * 本番は Supabase（supabaseRemote.ts）、テストは手元の入れ物を使う。
 */
export interface Remote {
  /** クラウドに選手か測定が1件でもあるか（削除済みは数えない） */
  hasAnyData(): Promise<boolean>
  /** after より後に変わった行を、変わった順に最大 limit 件（after = null なら最初から） */
  fetchChanges<T extends SyncTable>(table: T, after: string | null, limit: number): Promise<RowOf[T][]>
  /** 行を追加または上書きする（削除の印は外れる） */
  upsert<T extends SyncTable>(table: T, rows: RowOf[T][]): Promise<void>
  /** すでにある行を上書きする（無い行・上書きを許されない行は permission の失敗） */
  update<T extends SyncTable>(table: T, rows: RowOf[T][]): Promise<void>
  /** 削除の印を付ける（クラウドに無い行は何もしない） */
  markDeleted(refs: SyncRef[]): Promise<void>
  /** 指定した行を読む（無ければ null） */
  fetchRows(refs: SyncRef[]): Promise<{ ref: SyncRef; row: AnyRow | null }[]>
}
