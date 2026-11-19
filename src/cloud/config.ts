/**
 * クラウド（Supabase）の接続先。
 * どちらも「公開してよい値」（アプリの中に書いて配る前提の値）。何を見られる・書けるかは、
 * データベース側のアクセスのルール（supabase/migrations/0001_init.sql）で決まる。
 * 秘密の鍵（secret / service_role）は、ここにも、どこのファイルにも書かないこと。
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://dhpzxeqgsyjevgxfhzkk.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_bR2r95CVjvvC34E1P5U52w_ciA2EVd2'
