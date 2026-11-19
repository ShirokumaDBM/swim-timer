import type { Member } from '../cloud/members'
import { LANES } from '../domain/lanes'
import type { SessionDraft } from '../domain/sessionDraft'
import { STROKES } from '../domain/sessionLabel'
import type { Id, Swimmer } from '../domain/types'
import { MAX_REPS } from '../repo/sessions'
import './SessionFields.css'

const REPS_PRESETS = [20, 30, 40]
const DISTANCE_PRESETS = [25, 50, 100]

interface Props {
  draft: SessionDraft
  onChange: (patch: Partial<SessionDraft>) => void
  swimmers: Swimmer[]
  /** 選手が1人もいないときの「選手管理へ」 */
  onGoSwimmers?: () => void
  /** 記録係に選べる人（クラウドと同期している端末の管理者だけ。null なら欄を出さない） */
  recorderOptions?: Member[] | null
  /** 記録係の候補を読み込めなかった理由 */
  recorderError?: string | null
}

/** 測定の設定（測定日・距離・本数・種目・サークル・メモ・参加選手・レーン）。新規作成と編集で共通 */
export function SessionFields({ draft, onChange, swimmers, onGoSwimmers, recorderOptions, recorderError }: Props) {
  const allIds = swimmers.map((s) => s.id)
  const selectedSwimmers = swimmers.filter((s) => draft.selected.has(s.id))

  function toggle(id: Id) {
    const next = new Set(draft.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ selected: next })
  }

  function setLane(id: Id, lane: number | null) {
    const next = { ...draft.lanes }
    if (lane == null) delete next[id]
    else next[id] = lane
    onChange({ lanes: next })
  }

  return (
    <>
      <div className="fields">
        <label>
          測定日
          <input type="date" value={draft.date} onChange={(e) => onChange({ date: e.target.value })} required />
        </label>

        <div className="field">
          <label htmlFor="distance">距離（m）</label>
          <div className="with-presets">
            <input
              id="distance"
              type="number"
              min={1}
              value={draft.distance}
              onChange={(e) => onChange({ distance: e.target.value })}
              className="num short"
            />
            {DISTANCE_PRESETS.map((d) => (
              <button
                type="button"
                key={d}
                className={draft.distance === String(d) ? 'preset selected' : 'preset'}
                onClick={() => onChange({ distance: String(d) })}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="reps">本数</label>
          <div className="with-presets">
            <input
              id="reps"
              type="number"
              min={1}
              max={MAX_REPS}
              value={draft.reps}
              onChange={(e) => onChange({ reps: e.target.value })}
              className="num short"
              placeholder="例：30"
            />
            {REPS_PRESETS.map((r) => (
              <button
                type="button"
                key={r}
                className={draft.reps === String(r) ? 'preset selected' : 'preset'}
                onClick={() => onChange({ reps: String(r) })}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <label>
          種目（任意）
          <select value={draft.stroke} onChange={(e) => onChange({ stroke: e.target.value })}>
            <option value="">指定なし</option>
            {STROKES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          サークル（任意）
          <input
            value={draft.circle}
            onChange={(e) => onChange({ circle: e.target.value })}
            placeholder={`例：1'00"`}
            className="short"
          />
        </label>

        <label className="wide">
          メモ（任意）
          <input value={draft.memo} onChange={(e) => onChange({ memo: e.target.value })} placeholder="例：シーズン初回" />
        </label>
      </div>

      <fieldset className="participants">
        <legend>
          参加する選手（{draft.selected.size}人選択中）
          {swimmers.length > 0 && (
            <>
              <button type="button" onClick={() => onChange({ selected: new Set(allIds) })}>
                全員選択
              </button>
              <button type="button" onClick={() => onChange({ selected: new Set() })}>
                選択を解除
              </button>
            </>
          )}
        </legend>
        {swimmers.length === 0 ? (
          <p className="empty">
            選手が登録されていません。
            {onGoSwimmers && (
              <button type="button" onClick={onGoSwimmers}>
                選手管理へ
              </button>
            )}
          </p>
        ) : (
          <div className="swimmer-checks">
            {swimmers.map((s) => (
              <label key={s.id} className={draft.selected.has(s.id) ? 'checked' : ''}>
                <input type="checkbox" checked={draft.selected.has(s.id)} onChange={() => toggle(s.id)} />
                {s.name}
                {s.grade && <span className="grade">{s.grade}</span>}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {selectedSwimmers.length > 0 && (
        <fieldset className="lanes">
          <legend>
            レーン（任意）
            <span className="hint">設定すると、測定入力でレーン順に並べ替えられます</span>
            {selectedSwimmers.some((s) => draft.lanes[s.id] != null) && (
              <button type="button" onClick={() => onChange({ lanes: {} })}>
                レーンをすべて解除
              </button>
            )}
          </legend>
          <div className="lane-rows">
            {selectedSwimmers.map((s) => {
              const current = draft.lanes[s.id] ?? null
              return (
                <div key={s.id} className="lane-row" role="radiogroup" aria-label={`${s.name}のレーン`}>
                  <span className="lane-name">{s.name}</span>
                  {[null, ...LANES].map((lane) => (
                    <button
                      type="button"
                      key={lane ?? 'none'}
                      role="radio"
                      aria-checked={current === lane}
                      aria-label={lane == null ? 'なし' : `${lane}レーン`}
                      className={current === lane ? 'lane-btn selected' : 'lane-btn'}
                      onClick={() => setLane(s.id, lane)}
                    >
                      {lane ?? '－'}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </fieldset>
      )}
      {(recorderOptions !== undefined || recorderError) && (
        <RecorderPicker
          options={recorderOptions ?? null}
          error={recorderError ?? null}
          selected={draft.recorderIds}
          onChange={(recorderIds) => onChange({ recorderIds })}
        />
      )}
    </>
  )
}

interface PickerProps {
  /** 候補（読み込み中は null） */
  options: Member[] | null
  error: string | null
  selected: readonly string[]
  onChange: (ids: string[]) => void
}

/** 記録係を選ぶ（承認された部員・管理者から、何人でも） */
function RecorderPicker({ options, error, selected, onChange }: PickerProps) {
  const candidates = (options ?? []).filter((m) => m.role !== 'pending')
  // 名簿にいなくなった人（承認を取り消された人など）も、外せるように並べる
  const unknown = selected.filter((id) => !candidates.some((m) => m.userId === id))
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])

  return (
    <fieldset className="recorders">
      <legend>
        記録係（{selected.length}人）
        <span className="hint">記録係は、この測定が入力中の間、全員分のタイムを入力・修正できます</span>
      </legend>
      {error ? (
        <p className="error">{error}</p>
      ) : !options ? (
        <p className="hint">部員名簿を読み込み中…</p>
      ) : (
        <div className="swimmer-checks">
          {candidates.map((m) => (
            <label key={m.userId} className={selected.includes(m.userId) ? 'checked' : ''}>
              <input type="checkbox" checked={selected.includes(m.userId)} onChange={() => toggle(m.userId)} />
              {m.displayName || '（名前なし）'}
              {m.role === 'admin' && <span className="grade">管理者</span>}
            </label>
          ))}
          {unknown.map((id) => (
            <label key={id} className="checked">
              <input type="checkbox" checked onChange={() => toggle(id)} />
              （名簿にいない人）
            </label>
          ))}
        </div>
      )}
      {options && selected.length === 0 && <p className="hint">選ばないと、管理者だけが入力できます。</p>}
    </fieldset>
  )
}
