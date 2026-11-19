import type { Session } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'
import { getSupabase } from './lazyClient'
import { fetchMyMember, refreshMyProfile, type Member } from './members'

export interface CloudUser {
  id: string
  name: string
  avatarUrl: string | null
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; error?: string }
  | {
      status: 'signedIn'
      user: CloudUser
      /** 名簿の自分の行（読み込み前・読めなかったときは null） */
      member: Member | null
      /** 名簿を読めなかった理由（電波がないなど）。前回の内容を表示している */
      memberError?: string
    }

// ---------- 状態の入れ物（画面のどこからでも同じ状態を見る） ----------

let state: AuthState = { status: 'loading' }
const listeners = new Set<() => void>()

function setState(next: AuthState) {
  state = next
  listeners.forEach((l) => l())
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export function getAuth(): AuthState {
  return state
}

/** ログイン状態が変わったら知らせる（画面以外から使う。戻り値で見張りをやめる） */
export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ---------- 名簿の自分の行（電波がないときのために、前回の内容を端末に残す） ----------

const MEMBER_CACHE_KEY = 'swim-timer:member'

function loadCachedMember(userId: string): Member | null {
  try {
    const m = JSON.parse(localStorage.getItem(MEMBER_CACHE_KEY) ?? 'null') as Member | null
    return m?.userId === userId ? m : null
  } catch {
    return null
  }
}

function saveCachedMember(m: Member | null) {
  try {
    if (m) localStorage.setItem(MEMBER_CACHE_KEY, JSON.stringify(m))
    else localStorage.removeItem(MEMBER_CACHE_KEY)
  } catch {
    // 保存できなくても動作には影響しない
  }
}

function userOf(session: Session): CloudUser {
  const meta = session.user.user_metadata ?? {}
  const name =
    meta.custom_claims?.global_name || meta.full_name || meta.name || meta.user_name || session.user.email || '名前なし'
  return { id: session.user.id, name: String(name), avatarUrl: meta.avatar_url ?? null }
}

/** 名簿の自分の行を読み直す（承認されたかどうかの確認にも使う） */
export async function reloadMember(): Promise<void> {
  if (state.status !== 'signedIn') return
  const user = state.user
  try {
    const member = await fetchMyMember(user.id)
    saveCachedMember(member)
    if (state.status === 'signedIn' && state.user.id === user.id) setState({ status: 'signedIn', user, member })
  } catch (err) {
    if (state.status === 'signedIn' && state.user.id === user.id) {
      setState({ ...state, memberError: err instanceof Error ? err.message : String(err) })
    }
  }
}

function applySession(session: Session | null, justSignedIn = false) {
  if (!session) {
    saveCachedMember(null)
    setState({ status: 'signedOut' })
    return
  }
  const user = userOf(session)
  // 同じ人のままなら、読み込み済みの名簿の行をそのまま使う（表示がちらつかないように）
  const member = state.status === 'signedIn' && state.user.id === user.id ? state.member : loadCachedMember(user.id)
  setState({ status: 'signedIn', user, member })
  // この中で直接クラウドを呼ぶと止まることがあるため（supabase-js の注意事項）、少し後で読み込む
  setTimeout(async () => {
    // ログインした直後は、名簿の表示名・アイコンを Discord の最新の値にする
    if (justSignedIn) await refreshMyProfile().catch(() => {})
    await reloadMember()
  }, 0)
}

/** Discord から戻ってきたときの URL の後始末（?code=… や ?error=… を消す） */
function takeRedirectError(): string | undefined {
  const url = new URL(window.location.href)
  const error = url.searchParams.get('error_description') ?? url.searchParams.get('error') ?? undefined
  let changed = false
  for (const key of ['code', 'error', 'error_code', 'error_description', 'state']) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  }
  if (changed) window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  if (!error) return undefined
  return /access_denied|denied/i.test(error)
    ? 'ログインがキャンセルされました。'
    : `ログインできませんでした（${error}）`
}

let started = false

/** ログイン状態の見張りを始める（アプリの起動時に1回。接続の部品は画面が出たあとで読み込む） */
export function startAuth() {
  if (started) return
  started = true
  // 電波が戻ったら、名簿を読み直す
  window.addEventListener('online', () => void reloadMember())
  void (async () => {
    try {
      const supabase = await getSupabase()
      supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') applySession(null)
        else if (event === 'SIGNED_IN') applySession(session, true)
        else if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') applySession(session)
      })
      const { data } = await supabase.auth.getSession()
      const redirectError = takeRedirectError()
      if (data.session) applySession(data.session)
      else setState({ status: 'signedOut', error: redirectError })
    } catch (err) {
      // 電波がなくて接続の部品を読み込めないときなど。端末の中だけで使う部分には影響しない
      setState({ status: 'signedOut', error: `ログイン状態を確かめられませんでした（${String(err)}）` })
    }
  })()
}

/** Discord でログイン（Discord の画面に移り、許可すると戻ってくる） */
export async function signInWithDiscord(): Promise<void> {
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: window.location.origin + window.location.pathname },
    })
    if (error) throw error
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setState({ status: 'signedOut', error: `ログインを始められませんでした（${message}）` })
  }
}

/** ログアウト（この端末だけ。電波がなくてもできる） */
export async function signOut(): Promise<void> {
  const supabase = await getSupabase().catch(() => null)
  await supabase?.auth.signOut({ scope: 'local' }).catch(() => {})
  applySession(null)
}
