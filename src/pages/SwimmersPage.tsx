import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import type { Swimmer } from '../domain/types'
import {
  addSwimmer,
  deleteSwimmer,
  listSwimmers,
  SwimmerError,
  updateSwimmer,
} from '../repo/swimmers'
import './SwimmersPage.css'

const GRADE_SUGGESTIONS = ['1年', '2年', '3年', '4年']

function errorMessage(e: unknown): string {
  return e instanceof SwimmerError ? e.message : `保存できませんでした: ${String(e)}`
}

export function SwimmersPage() {
  const swimmers = useLiveQuery(listSwimmers)
  const [message, setMessage] = useState<string | null>(null)

  if (!swimmers) return <p>読み込み中…</p>

  return (
    <div className="page swimmers-page">
      <AddForm onError={setMessage} onDone={() => setMessage(null)} />

      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}

      <div className="list-header">登録選手 {swimmers.length}人</div>

      {swimmers.length === 0 ? (
        <p className="empty">まだ選手が登録されていません。上のフォームから登録してください。</p>
      ) : (
        <table className="swimmers-table">
          <thead>
            <tr>
              <th>名前</th>
              <th>学年</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {swimmers.map((s) => (
              <SwimmerRow key={s.id} swimmer={s} onError={setMessage} onDone={() => setMessage(null)} />
            ))}
          </tbody>
        </table>
      )}

      <datalist id="grade-suggestions">
        {GRADE_SUGGESTIONS.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
    </div>
  )
}

interface Callbacks {
  onError: (msg: string) => void
  onDone: () => void
}

function AddForm({ onError, onDone }: Callbacks) {
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      await addSwimmer({ name, grade })
      setName('')
      onDone()
      // 学年はそのまま残す（同じ学年を続けて登録しやすくする）
      document.getElementById('new-swimmer-name')?.focus()
    } catch (err) {
      onError(errorMessage(err))
    }
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <label>
        名前
        <input
          id="new-swimmer-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例：山田 太郎"
          autoFocus
        />
      </label>
      <label>
        学年
        <input
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          list="grade-suggestions"
          placeholder="例：2年"
          className="grade-input"
        />
      </label>
      <button type="submit" className="primary">
        登録
      </button>
    </form>
  )
}

function SwimmerRow({ swimmer, onError, onDone }: { swimmer: Swimmer } & Callbacks) {
  const id = swimmer.id!
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(swimmer.name)
  const [grade, setGrade] = useState(swimmer.grade ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  async function run(action: () => Promise<void>) {
    try {
      await action()
      onDone()
      return true
    } catch (err) {
      onError(errorMessage(err))
      return false
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (await run(() => updateSwimmer(id, { name, grade }))) setEditing(false)
  }

  function startEdit() {
    setName(swimmer.name)
    setGrade(swimmer.grade ?? '')
    setEditing(true)
  }

  if (editing) {
    return (
      <tr className="editing">
        <td colSpan={3}>
          <form className="edit-form" onSubmit={save}>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="名前" />
            <input
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              list="grade-suggestions"
              className="grade-input"
              aria-label="学年"
            />
            <button type="submit" className="primary">
              保存
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              キャンセル
            </button>
          </form>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td>{swimmer.name}</td>
      <td>{swimmer.grade ?? ''}</td>
      <td className="actions">
        <div>
        {confirmingDelete ? (
          <>
            <span className="confirm-text">本当に削除しますか？</span>
            <button
              className="danger"
              onClick={async () => {
                await run(() => deleteSwimmer(id))
                setConfirmingDelete(false)
              }}
            >
              削除する
            </button>
            <button onClick={() => setConfirmingDelete(false)}>やめる</button>
          </>
        ) : (
          <>
            <button onClick={startEdit}>編集</button>
            <button className="danger-outline" onClick={() => setConfirmingDelete(true)}>
              削除
            </button>
          </>
        )}
        </div>
      </td>
    </tr>
  )
}
