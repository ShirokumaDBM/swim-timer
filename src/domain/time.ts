import type { Centis } from './types'

/**
 * 入力文字列をタイム（1/100秒単位）に変換する。変換できなければ null。
 *
 * 数字だけの入力（素早く打つための形式）:
 *   - 1〜2桁: 秒            "38"     → 38.00
 *   - 3〜4桁: 秒 + 1/100秒   "3852"   → 38.52
 *   - 5〜6桁: 分 + 秒 + 1/100秒 "10523" → 1:05.23
 * 区切りあり:
 *   - "38.52"、"38.5"（→ 38.50）、"1:05.23"、"1:05"
 */
export function parseTimeInput(input: string): Centis | null {
  const s = input.trim().replace(/：/g, ':').replace(/．/g, '.')
  if (s === '') return null

  if (/^\d+$/.test(s)) {
    if (s.length <= 2) return Number(s) * 100
    if (s.length <= 4) return Number(s)
    if (s.length <= 6) {
      const min = Number(s.slice(0, -4))
      const sec = Number(s.slice(-4, -2))
      const hund = Number(s.slice(-2))
      if (sec >= 60) return null
      return min * 6000 + sec * 100 + hund
    }
    return null
  }

  const m = /^(?:(\d+):)?(\d{1,2})(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return null
  const min = m[1] !== undefined ? Number(m[1]) : 0
  const sec = Number(m[2])
  const hund = m[3] !== undefined ? Number(m[3].padEnd(2, '0')) : 0
  if (m[1] !== undefined && sec >= 60) return null
  return min * 6000 + sec * 100 + hund
}

/** タイムを表示用文字列にする。60秒未満は "38.52"、以上は "1:05.23" */
export function formatTime(centis: Centis | null | undefined): string {
  if (centis == null || !Number.isFinite(centis)) return ''
  const total = Math.round(centis)
  const min = Math.floor(total / 6000)
  const sec = Math.floor((total % 6000) / 100)
  const hund = total % 100
  const ss = String(sec).padStart(min > 0 ? 2 : 1, '0')
  const hh = String(hund).padStart(2, '0')
  return min > 0 ? `${min}:${ss}.${hh}` : `${ss}.${hh}`
}

/**
 * 差を符号つきで表示する。"+1.19" / "-0.42" / "±0.00"
 * 差は秒で表す（1分を超えることはほぼないため "+62.00" のように表示）。
 */
export function formatDiff(diff: Centis | null | undefined): string {
  if (diff == null || !Number.isFinite(diff)) return ''
  const d = Math.round(diff)
  if (d === 0) return '±0.00'
  const abs = Math.abs(d)
  const body = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
  return d > 0 ? `+${body}` : `-${body}`
}
