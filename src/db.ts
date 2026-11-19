import Dexie, { type EntityTable } from 'dexie'
import type { Id, Session, Swimmer, TimeRecord } from './domain/types'

/** データベースに付ける目印（旧データを移したかどうか、同期の進み具合など） */
export interface MetaRecord {
  key: string
  value: unknown
}

/** クラウドと同期する表 */
export type SyncTable = 'swimmers' | 'sessions' | 'times'

/** 送信待ちの1件が指す行 */
export type SyncRef =
  | { table: 'swimmers'; id: Id }
  | { table: 'sessions'; id: Id }
  | { table: 'times'; sessionId: Id; swimmerId: Id; rep: number }

/**
 * 送信待ちの一覧（この端末で変えたが、まだクラウドへ送っていない行）。
 * 中身は持たず「どの行か」だけを覚える。送るときに、その時点の端末の内容（無ければ削除）を送る。
 * 同じ行を何度変えても1件にまとまる。
 */
export interface OutboxEntry {
  /** 行を表す文字列（例：'times:<測定>:<選手>:3'） */
  key: string
  ref: SyncRef
  /** 変えた順番。送っている間にまた変えられたかを見分けるのに使う */
  seq: number
}

/**
 * PC・スマホ内（ブラウザの IndexedDB）に保存するデータベース。
 *
 * 以前のデータベース（'swim-timer'、番号が連番）とは別の名前にしてある。
 * 番号の形式を変えるには作り直しが必要なため。旧データは起動時に一度だけこちらへ写す（src/repo/legacy.ts）。
 * 旧データベースは消さずに残すので、万一のときはそこから取り出せる。
 */
export const db = new Dexie('swim-timer-v2') as Dexie & {
  swimmers: EntityTable<Swimmer, 'id'>
  sessions: EntityTable<Session, 'id'>
  times: Dexie.Table<TimeRecord, [Id, Id, number]>
  meta: EntityTable<MetaRecord, 'key'>
  outbox: EntityTable<OutboxEntry, 'key'>
}

db.version(1).stores({
  swimmers: 'id, name, createdAt',
  sessions: 'id, date, [distance+reps], status',
  times: '[sessionId+swimmerId+rep], sessionId, swimmerId',
  meta: 'key',
})

// v2: クラウドとの同期のため、送信待ちの一覧を追加
db.version(2).stores({
  outbox: 'key, seq',
})

/** 新しい番号（世界で重ならないランダムな文字列） */
export function newId(): Id {
  return crypto.randomUUID()
}
