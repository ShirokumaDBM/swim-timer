import Dexie, { type EntityTable } from 'dexie'
import type { Session, Swimmer, TimeRecord } from './domain/types'

/** PC内（ブラウザの IndexedDB）に保存するデータベース */
export const db = new Dexie('swim-timer') as Dexie & {
  swimmers: EntityTable<Swimmer, 'id'>
  sessions: EntityTable<Session, 'id'>
  times: Dexie.Table<TimeRecord, [number, number, number]>
}

db.version(1).stores({
  swimmers: '++id, name, active',
  sessions: '++id, date, [distance+reps], status',
  times: '[sessionId+swimmerId+rep], sessionId, swimmerId',
})

// v2: 休部・引退（active）を廃止
db.version(2)
  .stores({ swimmers: '++id, name' })
  .upgrade((tx) =>
    tx
      .table('swimmers')
      .toCollection()
      .modify((s) => {
        delete s.active
      }),
  )
