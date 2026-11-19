import { createClient } from '@supabase/supabase-js'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config'

/** クラウドとの接続（アプリ全体で1つ） */
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // ログイン状態をこの端末に残す（毎回ログインしなくてよい）
    persistSession: true,
    autoRefreshToken: true,
    // Discord から戻ってきたときの URL（?code=...）を読んでログインを完了する
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})
