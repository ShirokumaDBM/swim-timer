/** ローカル時刻での日付 'YYYY-MM-DD'（toISOString は UTC なので朝9時前に前日になってしまう） */
export function toDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayString(): string {
  return toDateString(new Date())
}

/** 'YYYY-MM-DD' → '2026/11/07（土）' */
export function formatDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const w = '日月火水木金土'[d.getDay()]
  return `${m[1]}/${m[2]}/${m[3]}（${w}）`
}
