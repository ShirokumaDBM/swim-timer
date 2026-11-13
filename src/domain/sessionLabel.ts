import { formatDate } from './date'
import type { Session } from './types'

export const STROKES = [
  { value: 'Fr', label: '自由形（Fr）' },
  { value: 'Ba', label: '背泳ぎ（Ba）' },
  { value: 'Br', label: '平泳ぎ（Br）' },
  { value: 'Fly', label: 'バタフライ（Fly）' },
  { value: 'IM', label: '個人メドレー（IM）' },
] as const

/** '50m × 30本 Fr' */
export function sessionMenu(s: Pick<Session, 'distance' | 'reps' | 'stroke'>): string {
  return `${s.distance}m × ${s.reps}本${s.stroke ? ` ${s.stroke}` : ''}`
}

/** '2026/11/07（土） 50m × 30本 Fr' */
export function sessionTitle(s: Pick<Session, 'date' | 'distance' | 'reps' | 'stroke'>): string {
  return `${formatDate(s.date)} ${sessionMenu(s)}`
}
