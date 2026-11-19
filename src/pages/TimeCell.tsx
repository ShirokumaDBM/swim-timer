import { memo, useRef, useState, type KeyboardEvent } from 'react'
import type { CellValue } from '../domain/grid'
import { formatDiff, formatTime } from '../domain/time'
import type { Centis } from '../domain/types'

export type NavKey = 'next' | 'prev' | 'up' | 'down' | 'left' | 'right'

interface Props {
  row: number
  col: number
  value: CellValue
  diff: Centis | null
  /** 入力を確定する。読めない入力なら false */
  onCommit: (row: number, col: number, text: string) => boolean
  onNavigate: (row: number, col: number, key: NavKey) => void
  registerInput: (row: number, col: number, el: HTMLInputElement | null) => void
  highlight: boolean
  /** 見るだけ（記録係でない・終了済みなど）。矢印での移動はできる */
  readOnly?: boolean
}

const MISSING_MARK = '—'

function displayOf(value: CellValue): string {
  if (value === undefined) return ''
  if (value === null) return MISSING_MARK
  return formatTime(value)
}

const ARROWS: Record<string, NavKey> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

/** 入力表の1マス。入力中の文字はこのマスの中だけで持つ（表全体を再描画しないため） */
export const TimeCell = memo(function TimeCell({
  row,
  col,
  value,
  diff,
  onCommit,
  onNavigate,
  registerInput,
  highlight,
  readOnly = false,
}: Props) {
  /** null = まだ打ち込んでいない（保存済みの値を表示） */
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  /** Enter などで確定済みの文字列（直後の blur で二重に確定しないため） */
  const committed = useRef<string | null>(null)
  const display = displayOf(value)

  function commit(text: string): boolean {
    if (readOnly) return true
    if (text === committed.current) return true
    const ok = onCommit(row, col, text)
    setInvalid(!ok)
    if (ok) committed.current = text
    return ok
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const text = draft ?? display
    if (e.key === 'Enter') {
      e.preventDefault()
      if (commit(text)) onNavigate(row, col, e.shiftKey ? 'prev' : 'next')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(null)
      setInvalid(false)
      e.currentTarget.select()
    } else if (ARROWS[e.key]) {
      e.preventDefault()
      if (commit(text)) onNavigate(row, col, ARROWS[e.key])
    }
  }

  const diffClass = diff == null ? '' : diff > 0 ? 'slower' : diff < 0 ? 'faster' : 'same'

  return (
    <td
      className={[
        'time-cell',
        value === null ? 'missing' : '',
        invalid ? 'invalid' : '',
        highlight ? 'highlight' : '',
      ].join(' ')}
    >
      <input
        readOnly={readOnly}
        ref={(el) => registerInput(row, col, el)}
        className="num"
        value={draft ?? display}
        inputMode="decimal"
        autoComplete="off"
        aria-label={`${row + 1}人目 ${col + 1}本目`}
        onFocus={(e) => {
          // 表示中の値を全選択して、打ち始めたら置き換わるようにする。
          // ここで値を変えたり選択を遅らせたりすると、素早く打った最初の文字が消えるので同期的に選択する。
          committed.current = display
          e.currentTarget.select()
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          setInvalid(false)
        }}
        onBlur={() => {
          // 読めない入力のままフォーカスが外れたら、元の値に戻す
          if (draft !== null && !commit(draft)) setInvalid(false)
          setDraft(null)
          committed.current = null
        }}
        onKeyDown={onKeyDown}
      />
      <div className={`diff num ${diffClass}`}>{formatDiff(diff)}</div>
    </td>
  )
})
