import { describe, expect, it } from 'vitest'
import { formatDiff, formatTime, parseTimeInput } from './time'

describe('parseTimeInput', () => {
  it.each([
    ['3852', 3852],
    ['0952', 952],
    ['952', 952],
    ['38', 3800],
    ['10523', 6523],
    ['100000', 60000], // 10:00.00
    ['38.52', 3852],
    ['38.5', 3850],
    ['38', 3800],
    ['1:05.23', 6523],
    ['1:05', 6500],
    [' 38.52 ', 3852],
    ['1：05．23', 6523],
  ])('"%s" → %i', (input, expected) => {
    expect(parseTimeInput(input)).toBe(expected)
  })

  it.each(['', '   ', 'abc', '38.523', '1:65.00', '16523', '1234567', '-38.52', '1:5:00'])(
    '"%s" は変換できない',
    (input) => {
      expect(parseTimeInput(input)).toBeNull()
    },
  )
})

describe('formatTime', () => {
  it.each([
    [3852, '38.52'],
    [952, '9.52'],
    [3800, '38.00'],
    [5, '0.05'],
    [6000, '1:00.00'],
    [6523, '1:05.23'],
    [6005, '1:00.05'],
  ])('%i → "%s"', (centis, expected) => {
    expect(formatTime(centis)).toBe(expected)
  })

  it('平均値など小数は1/100秒に四捨五入する', () => {
    expect(formatTime(3852.4)).toBe('38.52')
    expect(formatTime(3852.6)).toBe('38.53')
  })

  it('null は空文字', () => {
    expect(formatTime(null)).toBe('')
  })

  it('parse → format で元に戻る', () => {
    for (const s of ['38.52', '9.05', '1:05.23', '2:00.00']) {
      expect(formatTime(parseTimeInput(s))).toBe(s)
    }
  })
})

describe('formatDiff', () => {
  it.each([
    [119, '+1.19'],
    [-42, '-0.42'],
    [0, '±0.00'],
    [5, '+0.05'],
    [-1000, '-10.00'],
    [6200, '+62.00'],
    [118.6, '+1.19'],
  ])('%d → "%s"', (diff, expected) => {
    expect(formatDiff(diff)).toBe(expected)
  })

  it('null は空文字', () => {
    expect(formatDiff(null)).toBe('')
  })
})
