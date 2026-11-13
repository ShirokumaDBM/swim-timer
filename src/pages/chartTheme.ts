/** グラフの色。線・点の色だけが選手を表し、文字は文字用の色を使う */
export const COLORS = {
  series: '#2a78d6',
  surface: '#fcfcfb',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  muted: '#898781',
  secondary: '#52514e',
}

/**
 * 重ねグラフの選手の色（決まった順番で使い、使い回さない）。
 * 色覚の違いがあっても隣どうしが見分けられる順番になっている（検証済み）。
 * 黄緑・黄・ピンクは背景との差が小さいので、凡例・線の端の名前・数値の表を必ず添える。
 */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']

/** 横軸の目盛り：20本以下は全部、それより多いときは 1 と 5本ごと */
export function repTicks(reps: number): number[] {
  if (reps <= 20) return Array.from({ length: reps }, (_, i) => i + 1)
  const ticks = [1]
  for (let r = 5; r <= reps; r += 5) ticks.push(r)
  return ticks
}
