import { getSupabase } from './lazyClient'

/**
 * 役割（supabase/migrations/0002_recorders.sql の説明を参照）。
 * 管理者が「部員」画面で承認・変更する。記録係は役割ではなく、測定ごとに指名する
 */
export type Role = 'pending' | 'member' | 'admin'

export const ROLE_LABELS: Record<Role, string> = {
  pending: '承認待ち',
  member: '部員',
  admin: '管理者',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  pending: '記録は見られません',
  member: '記録を見られる。記録係に指名された測定は、入力中の間タイムを入力できる',
  admin: 'すべての操作ができる（測定の作成、記録係の指名、終了後のタイム修正、部員の承認など）',
}

/** 部員名簿の1行 */
export interface Member {
  userId: string
  displayName: string
  avatarUrl: string | null
  role: Role
  /** 初めてログインした日時（ISO 8601） */
  createdAt: string
}

interface MemberRow {
  user_id: string
  display_name: string
  avatar_url: string | null
  role: Role
  created_at: string
}

const COLUMNS = 'user_id, display_name, avatar_url, role, created_at'

const fromRow = (r: MemberRow): Member => ({
  userId: r.user_id,
  displayName: r.display_name,
  avatarUrl: r.avatar_url,
  role: r.role,
  createdAt: r.created_at,
})

export class MemberError extends Error {}

function fail(action: string, error: { message: string }): never {
  // データベースが返すメッセージ（「管理者が1人もいなくなる…」など日本語のもの）はそのまま見せる
  throw new MemberError(/[ぁ-ん]/.test(error.message) ? error.message : `${action}できませんでした（${error.message}）`)
}

/** 自分の名簿の行（まだ無ければ null） */
export async function fetchMyMember(userId: string): Promise<Member | null> {
  const supabase = await getSupabase()
  const { data, error } = await supabase.from('members').select(COLUMNS).eq('user_id', userId).maybeSingle<MemberRow>()
  if (error) fail('名簿を読み込み', error)
  return data ? fromRow(data) : null
}

/** 表示名・アイコンを Discord の最新の値にする（ログインのたびに呼ぶ） */
export async function refreshMyProfile(): Promise<void> {
  const supabase = await getSupabase()
  const { error } = await supabase.rpc('refresh_my_profile')
  if (error) fail('表示名を更新', error)
}

/** 全員の名簿（管理者だけが読める）。承認待ちを先に、あとは初めてログインした順 */
export async function listMembers(): Promise<Member[]> {
  const supabase = await getSupabase()
  const { data, error } = await supabase.from('members').select(COLUMNS).order('created_at').returns<MemberRow[]>()
  if (error) fail('名簿を読み込み', error)
  const list = (data ?? []).map(fromRow)
  return [...list.filter((m) => m.role === 'pending'), ...list.filter((m) => m.role !== 'pending')]
}

/** 役割を変える（管理者だけができる） */
export async function updateMemberRole(userId: string, role: Role): Promise<void> {
  const supabase = await getSupabase()
  const { data, error } = await supabase.from('members').update({ role }).eq('user_id', userId).select('user_id')
  if (error) fail('役割を変更', error)
  // 管理者でなければ、データベースのルールで 0件の変更になる
  if (!data?.length) throw new MemberError('役割を変更できませんでした。管理者だけが変更できます。')
}
