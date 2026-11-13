import { describe, expect, it } from 'vitest'
import { formatDate, toDateString } from './date'

describe('toDateString', () => {
  it('ローカル時刻の日付を返す（朝早くでも前日にならない）', () => {
    expect(toDateString(new Date(2026, 10, 7, 0, 30))).toBe('2026-11-07')
    expect(toDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('formatDate', () => {
  it('曜日つきで表示する', () => {
    expect(formatDate('2026-11-07')).toBe('2026/11/07（土）')
  })

  it('形式が違えばそのまま返す', () => {
    expect(formatDate('abc')).toBe('abc')
  })
})
