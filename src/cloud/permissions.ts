import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { Session } from '../domain/types'
import { isLinked } from '../sync/engine'
import { useAuth } from './auth'

/**
 * この端末でできること（画面の出し分けに使う）。
 * 最終的な判断はクラウドのルール（RLS）で行う。ここは「押しても断られる操作」を最初から出さないためのもの。
 *
 * クラウドと同期していない端末は、これまでどおり全部できる（端末の中だけの記録なので）。
 * 同期している端末は、役割で決まる：
 *   管理者：すべて
 *   部員：見るだけ。ただし記録係に指名された入力中の測定は、タイムの入力・測定情報の編集・終了ができる
 *   承認待ち・ログインしていない：見るだけ
 */
export interface Permissions {
  /** この端末がクラウドと同期しているか */
  cloud: boolean
  isAdmin: boolean
  /** ログインしている人（記録係の判断に使う） */
  userId: string | null
  canCreateSession: boolean
  canDeleteSession: boolean
  /** 選手の登録・修正・削除 */
  canEditSwimmers: boolean
  /** その測定のタイムの入力・修正、測定情報の編集、測定の終了 */
  canEditSession: (s: Pick<Session, 'status' | 'recorderIds'>) => boolean
  /** その測定を編集できない理由（編集できるなら null） */
  whyReadOnly: (s: Pick<Session, 'status' | 'recorderIds'>) => string | null
  /** 選手・測定を作れない理由（作れるなら null） */
  whyNoCreate: string | null
  /** ログインしていない・承認待ちなど、役割より前の理由（なければ null） */
  generalReason: string | null
}

const LOCAL: Permissions = {
  cloud: false,
  isAdmin: true,
  userId: null,
  canCreateSession: true,
  canDeleteSession: true,
  canEditSwimmers: true,
  canEditSession: () => true,
  whyReadOnly: () => null,
  whyNoCreate: null,
  generalReason: null,
}

export function usePermissions(): Permissions {
  const linked = useLiveQuery(isLinked)
  const auth = useAuth()
  const userId = auth.status === 'signedIn' ? auth.user.id : null
  const role = auth.status === 'signedIn' ? (auth.member?.role ?? 'pending') : null
  // 入力中の測定のどれかで記録係になっているか（選手の登録ができる）
  const isOpenRecorder = useLiveQuery(
    async () =>
      userId != null && (await db.sessions.where('status').equals('in_progress').toArray()).some((s) => s.recorderIds?.includes(userId)),
    [userId],
    false,
  )

  // 同期しているかの確認が済むまでは、念のため見るだけにしておく
  if (linked === undefined) return { ...LOCAL, cloud: true, isAdmin: false, canCreateSession: false, canDeleteSession: false, canEditSwimmers: false, canEditSession: () => false, whyReadOnly: () => '読み込み中…', whyNoCreate: '読み込み中…', generalReason: '読み込み中…' }
  if (!linked) return LOCAL

  const admin = role === 'admin'
  const general =
    role === null
      ? 'ログインすると、記録係や管理者は入力・編集ができます。'
      : role === 'pending'
        ? '管理者が承認すると、記録を見られるようになります。'
        : null
  const isRecorder = (s: Pick<Session, 'recorderIds'>) => userId != null && !!s.recorderIds?.includes(userId)
  const canEditSession = (s: Pick<Session, 'status' | 'recorderIds'>) =>
    admin || (role === 'member' && s.status === 'in_progress' && isRecorder(s))

  return {
    cloud: true,
    isAdmin: admin,
    userId,
    canCreateSession: admin,
    canDeleteSession: admin,
    canEditSwimmers: admin || (role === 'member' && isOpenRecorder),
    canEditSession,
    whyReadOnly: (s) => {
      if (canEditSession(s)) return null
      if (general) return general
      if (isRecorder(s) && s.status !== 'in_progress') return '終了した測定のタイムを直せるのは、管理者だけです。'
      return 'この測定の記録係ではないため、見るだけです。入力・修正は、記録係（入力中の間）と管理者が行います。'
    },
    whyNoCreate: admin ? null : (general ?? '測定を作れるのは管理者です。記録係に指名されると、その測定に入力できます。'),
    generalReason: general,
  }
}
