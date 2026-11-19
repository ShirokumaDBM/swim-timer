import type { RealtimeChannel } from '@supabase/supabase-js'
import { liveQuery } from 'dexie'
import { useSyncExternalStore } from 'react'
import { getAuth, subscribeAuth } from '../cloud/auth'
import { getSupabase } from '../cloud/lazyClient'
import { db } from '../db'
import { adoptCloud, isApproved, isLinked, syncOnce, uploadLocal, type LinkChoice, type SyncContext } from './engine'
import { RemoteError, type Remote } from './remote'

/**
 * いつ同期するかを決める係。
 * 承認された人がログインしている間だけ動き、次のときに同期する：
 *   ログインした直後／端末で何か変えたとき（少し待ってまとめて）／ほかの端末が変えたという知らせ（リアルタイム）／
 *   電波が戻ったとき／画面に戻ってきたとき／念のため1分ごと
 */

export type SyncPhase =
  /** ログインしていない・承認されていない（同期しない） */
  | 'off'
  | 'syncing'
  /** 同期済み */
  | 'idle'
  /** 電波がない（送信待ちは端末に残っている） */
  | 'offline'
  | 'error'
  /** 初めての同期で、この端末の記録をどうするか選んでもらう必要がある */
  | 'needsChoice'

export interface SyncStatus {
  phase: SyncPhase
  /** 送信待ちの件数 */
  pending: number
  /** 最後に同期できた時刻（ms） */
  lastSyncedAt?: number
  error?: string
  choice?: LinkChoice
  /** 選択を「あとで」にした */
  choiceDismissed?: boolean
  /** 前回の同期で、部員の権限では送れずに取り消した変更の数 */
  rejected?: number
}

let status: SyncStatus = { phase: 'off', pending: 0 }
const listeners = new Set<() => void>()

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  listeners.forEach((l) => l())
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => status,
  )
}

// ---------- 今の人の役割 ----------

function currentContext(): SyncContext | null {
  const auth = getAuth()
  if (auth.status !== 'signedIn' || !auth.member || !isApproved(auth.member.role)) return null
  return { role: auth.member.role, userId: auth.user.id }
}

// ---------- 同期の実行 ----------

let remote: Remote | null = null
let running = false
let again = false
let timer: ReturnType<typeof setTimeout> | null = null

async function getRemote(): Promise<Remote> {
  if (!remote) {
    const [{ SupabaseRemote }, sb] = await Promise.all([import('./supabaseRemote'), getSupabase()])
    remote = new SupabaseRemote(sb)
  }
  return remote
}

/** 少し待ってから同期する（続けて呼ばれたら、まとめて1回にする） */
export function scheduleSync(delayMs = 1500) {
  if (!currentContext()) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void syncNow()
  }, delayMs)
}

/** 今すぐ同期する */
export async function syncNow(): Promise<void> {
  const ctx = currentContext()
  if (!ctx) return
  if (running) {
    // 同期中に呼ばれたら、終わってからもう1回
    again = true
    return
  }
  running = true
  setStatus({ phase: 'syncing', error: undefined })
  try {
    const result = await syncOnce(await getRemote(), ctx)
    if (result.kind === 'needsChoice') {
      setStatus({ phase: 'needsChoice', choice: result.choice })
    } else {
      setStatus({ phase: 'idle', lastSyncedAt: Date.now(), choice: undefined, rejected: result.rejected })
    }
  } catch (err) {
    const offline = !navigator.onLine || (err instanceof RemoteError && err.kind === 'network')
    setStatus({
      phase: offline ? 'offline' : 'error',
      error: offline ? undefined : err instanceof Error ? err.message : String(err),
    })
  } finally {
    running = false
  }
  if (again) {
    again = false
    void syncNow()
  }
}

/** 初めての同期：この端末の記録をクラウドに載せる */
export async function chooseUpload() {
  await uploadLocal()
  setStatus({ choice: undefined, choiceDismissed: false })
  await syncNow()
}

/** 初めての同期：この端末の記録を消して、クラウドの記録に切り替える */
export async function chooseCloud() {
  await adoptCloud()
  setStatus({ choice: undefined, choiceDismissed: false })
  await syncNow()
}

export function dismissChoice() {
  setStatus({ choiceDismissed: true })
}

// ---------- 見張り ----------

let channel: RealtimeChannel | null = null
let interval: ReturnType<typeof setInterval> | null = null
let activeKey: string | null = null

async function enable() {
  void syncNow()
  interval ??= setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow()
  }, 60_000)
  if (!channel) {
    const sb = await getSupabase()
    // ほかの端末が変えたら、すぐ取りに行く（中身はここでは使わず、いつもの受け取りで取る）
    channel = sb.channel('swim-timer-sync')
    for (const table of ['swimmers', 'sessions', 'times']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => scheduleSync(300))
    }
    channel.subscribe()
  }
}

async function disable() {
  if (timer) clearTimeout(timer)
  timer = null
  if (interval) clearInterval(interval)
  interval = null
  if (channel) {
    const ch = channel
    channel = null
    const sb = await getSupabase().catch(() => null)
    await sb?.removeChannel(ch)
  }
  setStatus({ phase: 'off', choice: undefined, error: undefined })
}

/** ログイン状態に合わせて、同期を始める・止める */
function onAuthChange() {
  const ctx = currentContext()
  const auth = getAuth()
  // 人か役割が変わったときだけ、やり直す
  const key = ctx && auth.status === 'signedIn' ? `${auth.user.id}:${ctx.role}` : null
  if (key === activeKey) return
  activeKey = key
  if (key) void enable()
  else void disable()
}

let started = false

export function startSync() {
  if (started) return
  started = true
  subscribeAuth(onAuthChange)
  onAuthChange()
  // 送信待ちの件数を見張り、増えたら少し待って同期する
  let last = 0
  liveQuery(() => db.outbox.count()).subscribe((n) => {
    setStatus({ pending: n })
    if (n > last) scheduleSync()
    last = n
  })
  window.addEventListener('online', () => scheduleSync(500))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(500)
  })
}

/** この端末がクラウドと同期しているか（画面の表示用） */
export { isLinked }
