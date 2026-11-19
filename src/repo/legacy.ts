import Dexie from 'dexie'
import { db, newId } from '../db'
import { convertLegacy, type LegacyData } from '../domain/legacy'

const LEGACY_DB = 'swim-timer'
const FLAG = 'legacyMigrated'

export type MigrationResult = 'migrated' | 'nothing' | 'already'

/**
 * 以前のデータベース（番号が連番）の記録を、今のデータベースへ一度だけ写す。
 * - 旧データベースは読むだけで、消さない
 * - 今のデータベースにすでに記録があれば、上書きしない
 * - 途中で失敗したら何も写さず、次の起動でもう一度試す
 */
export async function migrateLegacyData(): Promise<MigrationResult> {
  if (await db.meta.get(FLAG)) return 'already'
  if (!(await Dexie.exists(LEGACY_DB))) {
    await db.meta.put({ key: FLAG, value: 'nothing' })
    return 'nothing'
  }

  const old = new Dexie(LEGACY_DB)
  let legacy: LegacyData
  try {
    await old.open()
    const names = new Set(old.tables.map((t) => t.name))
    const read = (name: string) => (names.has(name) ? old.table(name).toArray() : Promise.resolve([]))
    const [swimmers, sessions, times] = await Promise.all([read('swimmers'), read('sessions'), read('times')])
    legacy = { swimmers, sessions, times }
  } finally {
    old.close()
  }

  const converted = convertLegacy(legacy, newId)
  return db.transaction('rw', db.swimmers, db.sessions, db.times, db.meta, async () => {
    const empty = (await db.swimmers.count()) + (await db.sessions.count()) + (await db.times.count()) === 0
    const hasData = converted.swimmers.length + converted.sessions.length > 0
    if (empty && hasData) {
      await db.swimmers.bulkAdd(converted.swimmers)
      await db.sessions.bulkAdd(converted.sessions)
      await db.times.bulkAdd(converted.times)
    }
    await db.meta.put({ key: FLAG, value: empty && hasData ? 'migrated' : 'nothing' })
    return empty && hasData ? 'migrated' : 'nothing'
  })
}
