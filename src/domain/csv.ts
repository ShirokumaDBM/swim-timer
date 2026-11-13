import { formatDate } from './date'
import type { Grid } from './grid'
import { toRepTimes } from './grid'
import { sessionMenu } from './sessionLabel'
import { swimmerStats } from './stats'
import { formatTime } from './time'
import type { Session } from './types'

/** CSV の1マス。カンマ・改行・ダブルクォートを含むときは "..." で囲む */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function csvLine(cells: string[]): string {
  return cells.map(csvCell).join(',')
}

/**
 * 結果表の CSV（Excel で開ける形。改行は CRLF）。
 * 先頭に測定の情報、1行空けて 選手 × 本数 の表。休んだ本は「-」、未入力は空欄。
 */
export function resultCsv(
  session: Pick<Session, 'date' | 'distance' | 'reps' | 'stroke' | 'circle' | 'memo'>,
  names: string[],
  grid: Grid,
  lanes?: (number | null)[],
): string {
  const withLanes = !!lanes?.some((l) => l != null)
  const reps = Array.from({ length: session.reps }, (_, i) => String(i + 1))
  const lines = [
    csvLine(['測定日', formatDate(session.date)]),
    csvLine(['メニュー', sessionMenu(session)]),
    ...(session.circle ? [csvLine(['サークル', session.circle])] : []),
    ...(session.memo ? [csvLine(['メモ', session.memo])] : []),
    '',
    csvLine([...(withLanes ? ['レーン'] : []), '選手', '平均', ...reps, 'ベスト', 'ワースト', 'ばらつき', '本数']),
    ...grid.map((row, r) => {
      const s = swimmerStats(toRepTimes(row))
      return csvLine([
        ...(withLanes ? [lanes![r] == null ? '' : String(lanes![r])] : []),
        names[r],
        formatTime(s.average),
        ...row.map((v) => (v === undefined ? '' : v === null ? '-' : formatTime(v))),
        formatTime(s.best),
        formatTime(s.worst),
        s.stdDev == null ? '' : (s.stdDev / 100).toFixed(2),
        `${s.count}/${session.reps}`,
      ])
    }),
  ]
  return lines.join('\r\n') + '\r\n'
}

/** 保存するファイル名（例：swim-result-2026-11-08-50m-30本.csv） */
export function resultCsvFileName(session: Pick<Session, 'date' | 'distance' | 'reps'>): string {
  return `swim-result-${session.date}-${session.distance}m-${session.reps}本.csv`
}
