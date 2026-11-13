import { describe, expect, it } from 'vitest'
import { csvCell, resultCsv, resultCsvFileName } from './csv'

describe('csvCell', () => {
  it('カンマ・改行・ダブルクォートを含むときだけ囲む', () => {
    expect(csvCell('山田')).toBe('山田')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('1\'00"')).toBe('"1\'00"""')
    expect(csvCell('1行目\n2行目')).toBe('"1行目\n2行目"')
  })
})

describe('resultCsv', () => {
  const session = { date: '2026-11-08', distance: 50, reps: 3, stroke: 'Fr', circle: '1\'00"', memo: '記録会前, 雨' }

  it('測定の情報と結果表', () => {
    const csv = resultCsv(session, ['山田', '佐藤'], [
      [3800, null, 3900],
      [4000, undefined, undefined],
    ])
    expect(csv.split('\r\n')).toEqual([
      '測定日,2026/11/08（日）',
      'メニュー,50m × 3本 Fr',
      'サークル,"1\'00"""',
      'メモ,"記録会前, 雨"',
      '',
      '選手,平均,1,2,3,ベスト,ワースト,ばらつき,本数',
      '山田,38.50,38.00,-,39.00,38.00,39.00,0.50,2/3',
      '佐藤,40.00,40.00,,,40.00,40.00,,1/3',
      '',
    ])
  })

  it('レーンがあれば先頭の列に出す', () => {
    const csv = resultCsv({ ...session, circle: undefined, memo: undefined }, ['山田'], [[3800, 3800, 3800]], [2])
    expect(csv.split('\r\n').slice(3, 5)).toEqual([
      'レーン,選手,平均,1,2,3,ベスト,ワースト,ばらつき,本数',
      '2,山田,38.00,38.00,38.00,38.00,38.00,38.00,0.00,3/3',
    ])
  })
})

describe('resultCsvFileName', () => {
  it('日付と条件入り', () => {
    expect(resultCsvFileName({ date: '2026-11-08', distance: 50, reps: 30 })).toBe(
      'swim-result-2026-11-08-50m-30本.csv',
    )
  })
})
