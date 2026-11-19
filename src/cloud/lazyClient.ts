import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * クラウドとの接続を、必要になったときに読み込む。
 * 接続の部品は大きいので、最初の画面の表示（端末の中だけで使う部分）を遅くしないようにする。
 */
let loading: Promise<SupabaseClient> | null = null

export function getSupabase(): Promise<SupabaseClient> {
  loading ??= import('./client').then((m) => m.supabase)
  return loading
}
