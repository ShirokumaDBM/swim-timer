import type { MetricKey } from '../domain/compare'
import { formatDiff, formatTime } from '../domain/time'
import type { Centis } from '../domain/types'

export interface MetricOption {
  key: MetricKey
  label: string
  /** 値そのものに符号を付けて表示する（落ち幅） */
  signed?: boolean
  /** 補足の説明 */
  title?: string
  /** グラフで「上に行くほど」何を表すか */
  upMeans: string
}

/** 比べられる値の一覧。どれも「小さいほど良い」（速い・安定している・後半に落ちない） */
export const METRIC_OPTIONS: MetricOption[] = [
  { key: 'average', label: '平均', upMeans: '遅いタイム' },
  { key: 'best', label: 'ベスト', title: 'その測定でいちばん速かった1本', upMeans: '遅いタイム' },
  { key: 'worst', label: 'ワースト', title: 'その測定でいちばん遅かった1本', upMeans: '遅いタイム' },
  {
    key: 'stdDev',
    label: 'ばらつき',
    title: 'タイムのばらつき（標準偏差）。小さいほど安定',
    upMeans: 'ばらつきが大きい（タイムが安定していない）こと',
  },
  { key: 'firstHalf', label: '前半の平均', upMeans: '遅いタイム' },
  { key: 'secondHalf', label: '後半の平均', upMeans: '遅いタイム' },
  {
    key: 'fade',
    label: '落ち幅',
    signed: true,
    title: '後半の平均 − 前半の平均。プラスは後半に遅くなったことを表す',
    upMeans: '後半の落ち込みが大きいこと（マイナスは後半の方が速い）',
  },
]

/** 値の表示（落ち幅は符号つき） */
export function formatMetric(option: Pick<MetricOption, 'signed'>, value: Centis | null | undefined): string {
  return option.signed ? formatDiff(value) : formatTime(value)
}
