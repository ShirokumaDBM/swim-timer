import { useEffect, useState } from 'react'
import { listMembers, type Member } from './members'

/**
 * 部員名簿（管理者だけが読める）。記録係を選ぶ・記録係の名前を出すのに使う。
 * enabled = false のとき（管理者でない・同期していない）は読み込まない
 */
export function useMembers(enabled: boolean): { members: Member[] | null; error: string | null } {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    listMembers().then(
      (list) => {
        if (!cancelled) setMembers(list)
      },
      (err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      },
    )
    return () => {
      cancelled = true
    }
  }, [enabled])
  return { members: enabled ? members : null, error: enabled ? error : null }
}
