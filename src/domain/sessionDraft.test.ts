import { describe, expect, it } from 'vitest'
import { draftFromSession, draftToInput, emptyDraft, timesRemovedBy } from './sessionDraft'
import type { Session, TimeRecord } from './types'

const session: Session = {
  id: 1,
  date: '2026-11-08',
  distance: 50,
  reps: 30,
  stroke: 'Fr',
  memo: 'メモ',
  swimmerIds: [3, 1, 2],
  lanes: [2, null, 4],
  status: 'in_progress',
  createdAt: 0,
}

describe('draftFromSession / draftToInput', () => {
  it('測定の内容がフォームに入り、元に戻せる', () => {
    const d = draftFromSession(session, [1, 2, 3])
    expect(d).toMatchObject({ date: '2026-11-08', distance: '50', reps: '30', stroke: 'Fr', circle: '', memo: 'メモ' })
    expect([...d.selected]).toEqual([3, 1, 2])
    expect(d.lanes).toEqual({ 3: 2, 2: 4 })
    // 保存時は選手一覧の順番
    expect(draftToInput(d, [1, 2, 3])).toEqual({
      date: '2026-11-08',
      distance: 50,
      reps: 30,
      stroke: 'Fr',
      circle: '',
      memo: 'メモ',
      swimmerIds: [1, 2, 3],
      lanes: { 3: 2, 2: 4 },
    })
  })

  it('削除された選手は外す', () => {
    const d = draftFromSession(session, [1, 2])
    expect([...d.selected]).toEqual([1, 2])
    expect(d.lanes).toEqual({ 2: 4 })
  })

  it('本数が空なら NaN（保存時にエラーになる）', () => {
    expect(draftToInput(emptyDraft('2026-11-08'), []).reps).toBeNaN()
  })
})

describe('timesRemovedBy', () => {
  const t = (swimmerId: number, rep: number): TimeRecord => ({ sessionId: 1, swimmerId, rep, centis: 3800 })
  const records = [t(1, 1), t(1, 25), t(2, 1), t(2, 30)]

  it('外した選手の分と、本数を減らした分が消える', () => {
    expect(timesRemovedBy(records, [1], 20)).toEqual([t(1, 25), t(2, 1), t(2, 30)])
  })

  it('選手を増やす・本数を増やすだけなら何も消えない', () => {
    expect(timesRemovedBy(records, [1, 2, 3], 40)).toEqual([])
  })
})
