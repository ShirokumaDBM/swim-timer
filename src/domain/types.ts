/**
 * タイムはすべて「1/100秒単位の整数（centis）」で扱う。
 * 例: 38.52秒 → 3852、1:05.23 → 6523
 * 小数（浮動小数点）で計算すると 38.52 - 37.33 = 1.1900000000000013 のような誤差が出るため。
 */
export type Centis = number

export interface Swimmer {
  id?: number
  name: string
  grade?: string
}

export type SessionStatus = 'in_progress' | 'finished'

export interface Session {
  id?: number
  /** 'YYYY-MM-DD' */
  date: string
  /** 距離（m） */
  distance: number
  /** 本数 N */
  reps: number
  stroke?: string
  circle?: string
  memo?: string
  /** 参加選手（表示順） */
  swimmerIds: number[]
  /** 各選手のレーン（1〜5、swimmerIds と同じ並び。未設定は null）。誰も設定していなければ省略 */
  lanes?: (number | null)[]
  status: SessionStatus
  /** 作成日時（ms）。同じ日に複数回測定したときの並び順に使う */
  createdAt: number
}

export interface TimeRecord {
  sessionId: number
  swimmerId: number
  /** 何本目か（1始まり） */
  rep: number
  /** null = 欠損（その本を休んだ） */
  centis: Centis | null
}

/**
 * 1人分のタイム列。index 0 が1本目。
 * 未入力・欠損は null。
 */
export type RepTimes = (Centis | null)[]
