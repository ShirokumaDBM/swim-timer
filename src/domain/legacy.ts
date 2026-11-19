import type { Id, Session, Swimmer, TimeRecord } from './types'

/** 以前の形式（番号が 1, 2, 3… の連番）のデータ */
export interface LegacyData {
  swimmers: { id: number; name: string; grade?: string }[]
  sessions: (Omit<Session, 'id' | 'swimmerIds'> & { id: number; swimmerIds: number[] })[]
  times: { sessionId: number; swimmerId: number; rep: number; centis: number | null }[]
}

export interface ConvertedData {
  swimmers: Swimmer[]
  sessions: Session[]
  times: TimeRecord[]
}

/**
 * 連番のデータを、新しい形式（ランダムな番号）に変換する。
 * - 選手の登録順は、元の番号の順のまま残す（createdAt に元の番号を入れる。新しく登録する選手はそれより後になる）
 * - 削除済みの選手を指している測定は、その選手にも新しい番号を割り当てる（「削除された選手」として残す）
 * - 存在しない測定を指しているタイムは捨てる（画面のどこにも出ないため）
 */
export function convertLegacy(data: LegacyData, newId: () => Id): ConvertedData {
  const swimmerMap = new Map<number, Id>()
  const swimmerId = (old: number): Id => {
    let id = swimmerMap.get(old)
    if (!id) {
      id = newId()
      swimmerMap.set(old, id)
    }
    return id
  }
  const sessionMap = new Map<number, Id>()

  const swimmers: Swimmer[] = data.swimmers.map((s) => ({
    id: swimmerId(s.id),
    name: s.name,
    ...(s.grade !== undefined && { grade: s.grade }),
    createdAt: s.id,
  }))
  const sessions: Session[] = data.sessions.map((s) => {
    const id = newId()
    sessionMap.set(s.id, id)
    return { ...s, id, swimmerIds: s.swimmerIds.map(swimmerId) }
  })
  const times: TimeRecord[] = data.times
    .filter((t) => sessionMap.has(t.sessionId))
    .map((t) => ({
      sessionId: sessionMap.get(t.sessionId)!,
      swimmerId: swimmerId(t.swimmerId),
      rep: t.rep,
      centis: t.centis,
    }))
  return { swimmers, sessions, times }
}
