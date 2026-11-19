import type { Id, Session, TimeRecord } from './types'

/** 測定の設定フォームの入力内容（新規作成・編集で共通） */
export interface SessionDraft {
  date: string
  distance: string
  reps: string
  stroke: string
  circle: string
  memo: string
  selected: ReadonlySet<Id>
  /** 選手ID → レーン */
  lanes: Readonly<Record<Id, number>>
  /** 記録係（クラウドの部員名簿の user_id） */
  recorderIds: readonly string[]
}

export function emptyDraft(date: string): SessionDraft {
  return { date, distance: '50', reps: '', stroke: '', circle: '', memo: '', selected: new Set(), lanes: {}, recorderIds: [] }
}

/** 既存の測定からフォームの内容を作る（今いない選手は外す） */
export function draftFromSession(s: Session, existingIds: readonly Id[]): SessionDraft {
  const exists = new Set(existingIds)
  const lanes: Record<Id, number> = {}
  s.swimmerIds.forEach((id, i) => {
    const lane = s.lanes?.[i]
    if (lane != null && exists.has(id)) lanes[id] = lane
  })
  return {
    date: s.date,
    distance: String(s.distance),
    reps: String(s.reps),
    stroke: s.stroke ?? '',
    circle: s.circle ?? '',
    memo: s.memo ?? '',
    selected: new Set(s.swimmerIds.filter((id) => exists.has(id))),
    lanes,
    recorderIds: s.recorderIds ?? [],
  }
}

/** フォームの内容を保存用の値にする。参加選手は選手一覧（allIds）の順番で並べる */
export function draftToInput(d: SessionDraft, allIds: readonly Id[]) {
  return {
    date: d.date,
    distance: Number(d.distance),
    reps: d.reps.trim() === '' ? NaN : Number(d.reps),
    stroke: d.stroke,
    circle: d.circle,
    memo: d.memo,
    swimmerIds: allIds.filter((id) => d.selected.has(id)),
    lanes: { ...d.lanes },
    recorderIds: [...d.recorderIds],
  }
}

/** 参加選手・本数を変えたときに消えるタイム（外した選手の分と、減らした本数より後の分） */
export function timesRemovedBy(records: readonly TimeRecord[], swimmerIds: readonly Id[], reps: number): TimeRecord[] {
  const keep = new Set(swimmerIds)
  return records.filter((t) => !keep.has(t.swimmerId) || t.rep > reps)
}
