/**
 * タイムはすべて「1/100秒単位の整数（centis）」で扱う。
 * 例: 38.52秒 → 3852、1:05.23 → 6523
 * 小数（浮動小数点）で計算すると 38.52 - 37.33 = 1.1900000000000013 のような誤差が出るため。
 */
export type Centis = number

/**
 * 選手・測定の番号。端末ごとに重ならないよう、ランダムな文字列（UUID）を使う。
 * （複数の端末の記録をクラウドでまとめるときに、番号がぶつからないようにするため）
 */
export type Id = string

export interface Swimmer {
  id: Id
  name: string
  grade?: string
  /** 登録日時（ms）。一覧の並び順（登録順）に使う */
  createdAt: number
}

export type SessionStatus = 'in_progress' | 'finished'

export interface Session {
  id: Id
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
  swimmerIds: Id[]
  /** 各選手のレーン（1〜5、swimmerIds と同じ並び。未設定は null）。誰も設定していなければ省略 */
  lanes?: (number | null)[]
  status: SessionStatus
  /** 記録係（クラウドの部員名簿の user_id）。クラウドと同期しない端末では使わない */
  recorderIds?: string[]
  /** 作成日時（ms）。同じ日に複数回測定したときの並び順に使う */
  createdAt: number
}

export interface TimeRecord {
  sessionId: Id
  swimmerId: Id
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
