import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { CellValue, Grid } from '../domain/grid'
import type { SwimmerStats } from '../domain/stats'
import { formatDiff, formatTime } from '../domain/time'
import './MobileEntry.css'

interface Props {
  grid: Grid
  stats: SwimmerStats[]
  names: string[]
  /** レーン（設定がなければ undefined） */
  lanes?: (number | null)[]
  reps: number
  /** 最初に開く本（0始まり。全員入力済みの次の本） */
  initialRep: number
  /** 入力を確定する。読めない入力なら false（表の入力と同じ処理） */
  onCommit: (row: number, col: number, text: string) => boolean
  /** 4桁入力したら自動で次の選手へ進む */
  autoNext: boolean
  onChangeAutoNext: (on: boolean) => void
}

const MISSING_MARK = '—'
const displayOf = (v: CellValue) => (v === undefined ? '' : v === null ? MISSING_MARK : formatTime(v))

/**
 * スマホ用の入力：1本ずつ、選手を縦に並べて入力する。
 * iPhone の数字キーボードには Enter が無いので、「次へ」ボタン・別の欄をタップ・（設定すれば）4桁入力で確定する。
 */
export function MobileEntry({ grid, stats, names, lanes, reps, initialRep, onCommit, autoNext, onChangeAutoNext }: Props) {
  const rows = grid.length
  const [rep, setRep] = useState(Math.min(initialRep, reps - 1))
  const [active, setActive] = useState<number | null>(null)
  const inputs = useRef(new Map<number, HTMLInputElement>())
  /** 本を切り替えた直後にカーソルを置く行 */
  const focusAfterRepChange = useRef<number | null>(null)

  useEffect(() => {
    const row = focusAfterRepChange.current
    if (row == null) return
    focusAfterRepChange.current = null
    inputs.current.get(row)?.focus()
  }, [rep])

  const filled = grid.filter((row) => row[rep] !== undefined).length

  function goRep(next: number, focusRow: number | null = null) {
    if (next < 0 || next >= reps) return
    focusAfterRepChange.current = focusRow
    setRep(next)
  }

  /** row の次の入力欄へ。最後の選手なら次の本の先頭へ（最後の本ならキーボードを閉じる） */
  function focusNext(row: number) {
    if (row + 1 < rows) inputs.current.get(row + 1)?.focus()
    else if (rep + 1 < reps) goRep(rep + 1, 0)
    else inputs.current.get(row)?.blur()
  }

  return (
    <div className="mobile-entry">
      <div className="rep-nav">
        <button onClick={() => goRep(rep - 1)} disabled={rep === 0} aria-label="前の本">
          ◀
        </button>
        <div className="rep-title" aria-live="polite">
          <strong className="num">{rep + 1}</strong>
          <span>本目</span>
          <span className="hint">
            / {reps}本・入力 {filled}/{rows}人
          </span>
        </div>
        <button onClick={() => goRep(rep + 1)} disabled={rep === reps - 1} aria-label="次の本">
          ▶
        </button>
      </div>

      <ul className="entry-list">
        {grid.map((row, r) => (
          <EntryRow
            // 本を切り替えたら、打ちかけの文字は持ち越さない
            key={`${rep}-${r}`}
            name={names[r]}
            lane={lanes?.[r]}
            value={row[rep]}
            previous={rep > 0 ? row[rep - 1] : undefined}
            diff={stats[r].diffs[rep]}
            average={stats[r].average}
            isActive={active === r}
            autoNext={autoNext}
            label={`${names[r]} ${rep + 1}本目`}
            register={(el) => {
              if (el) inputs.current.set(r, el)
              else inputs.current.delete(r)
            }}
            onFocus={() => setActive(r)}
            onBlur={() => setActive((a) => (a === r ? null : a))}
            onCommit={(text) => onCommit(r, rep, text)}
            onNext={() => focusNext(r)}
          />
        ))}
      </ul>

      <div className="entry-foot">
        <label className="auto-next">
          <input type="checkbox" checked={autoNext} onChange={(e) => onChangeAutoNext(e.target.checked)} />
          4桁入力したら自動で次の選手へ（1分以上のタイムがあるときは切る）
        </label>
        <p className="hint">
          <code>3852</code> → 38.52、<code>10523</code> → 1:05.23。入力は「次へ」か、ほかの欄をタップすると保存されます。
          消すときは、欄を空にして「次へ」を押します。
        </p>
      </div>
    </div>
  )
}

interface RowProps {
  name: string
  lane?: number | null
  value: CellValue
  /** 前の本のタイム（1本目は undefined） */
  previous: CellValue
  diff: number | null
  average: number | null
  isActive: boolean
  autoNext: boolean
  label: string
  register: (el: HTMLInputElement | null) => void
  onFocus: () => void
  onBlur: () => void
  onCommit: (text: string) => boolean
  onNext: () => void
}

function EntryRow({
  name,
  lane,
  value,
  previous,
  diff,
  average,
  isActive,
  autoNext,
  label,
  register,
  onFocus,
  onBlur,
  onCommit,
  onNext,
}: RowProps) {
  /** null = まだ打ち込んでいない（保存済みの値を表示） */
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  /** 確定済みの文字列（直後の blur で二重に確定しないため） */
  const committed = useRef<string | null>(null)
  const display = displayOf(value)

  function commit(text: string): boolean {
    if (text === committed.current) return true
    const ok = onCommit(text)
    setInvalid(!ok)
    if (ok) committed.current = text
    return ok
  }

  /** 「次へ」「休み」などで確定済み。直後の blur で、打ちかけの文字を上書き保存しないための印 */
  const settled = useRef(false)

  function commitAndNext(text: string) {
    if (!commit(text)) return
    settled.current = true
    onNext()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitAndNext(draft ?? display)
    }
  }

  const diffClass = diff == null ? '' : diff > 0 ? 'slower' : diff < 0 ? 'faster' : 'same'

  return (
    <li className={['entry-row', isActive ? 'active' : '', invalid ? 'invalid' : ''].join(' ')}>
      <div className="who">
        {lane !== undefined && (
          <span className={lane == null ? 'lane-badge none' : 'lane-badge'}>{lane ?? '－'}</span>
        )}
        <span className="name">{name}</span>
      </div>
      <div className="info hint num">
        {previous != null && <span>前 {formatTime(previous)}</span>}
        {diff != null && <span className={`diff ${diffClass}`}>{formatDiff(diff)}</span>}
        {average != null && <span>平均 {formatTime(average)}</span>}
      </div>
      <div className="entry">
        <input
          ref={register}
          className={value === null && draft === null ? 'num missing' : 'num'}
          value={draft ?? display}
          // 数字だけのキーボードを出す（タイムは 3852 のように数字だけで入力できる）
          inputMode="numeric"
          enterKeyHint="next"
          autoComplete="off"
          aria-label={label}
          onFocus={(e) => {
            settled.current = false
            committed.current = display
            e.currentTarget.select()
            onFocus()
          }}
          onChange={(e) => {
            const text = e.target.value
            setDraft(text)
            setInvalid(false)
            // 数字4桁（例：3852）で自動的に確定して次へ
            if (autoNext && /^\d{4}$/.test(text)) commitAndNext(text)
          }}
          onBlur={() => {
            // 読めない入力のままほかへ移ったら、元の値に戻す
            if (!settled.current && draft !== null && !commit(draft)) setInvalid(false)
            settled.current = false
            setDraft(null)
            committed.current = null
            onBlur()
          }}
          onKeyDown={onKeyDown}
        />
        {/* ボタンは全部の行に同じ場所・同じ大きさで置く。
            入力中の行だけ段が増えたりすると、ほかをタップした瞬間に画面がずれて押し間違える */}
        <button
          className="rest"
          aria-label={`${label}を休みにする`}
          // 押してもキーボードが閉じないよう、入力欄からカーソルを外さない
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => commitAndNext('-')}
        >
          休み
        </button>
        <button
          className={isActive ? 'primary next' : 'primary next idle'}
          tabIndex={isActive ? 0 : -1}
          aria-hidden={!isActive}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => commitAndNext(draft ?? display)}
        >
          次へ
        </button>
      </div>
      {invalid && (
        <p className="row-error" role="alert">
          タイムとして読めません（例：3852 → 38.52）
        </p>
      )}
    </li>
  )
}
