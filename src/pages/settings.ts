import type { InputOrder } from '../domain/grid'
import type { LaneOrder } from '../domain/lanes'

/** 画面の設定（このPCのブラウザに保存。保存できなくても動作には影響しない） */
const ORDER_KEY = 'swim-timer:inputOrder'
const LANE_ORDER_KEY = 'swim-timer:laneOrder'

function loadSetting(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function saveSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 保存できなくても動作には影響しない
  }
}

/** Enter で進む向き */
export function loadInputOrder(): InputOrder {
  return loadSetting(ORDER_KEY) === 'bySwimmer' ? 'bySwimmer' : 'byRep'
}

export function saveInputOrder(order: InputOrder) {
  saveSetting(ORDER_KEY, order)
}

/** レーンが設定された測定での並び順（既定はレーン昇順） */
export function loadLaneOrder(): LaneOrder {
  const v = loadSetting(LANE_ORDER_KEY)
  return v === 'entry' || v === 'desc' ? v : 'asc'
}

export function saveLaneOrder(order: LaneOrder) {
  saveSetting(LANE_ORDER_KEY, order)
}

/** 入力画面の形：表（PC向け）／1本ずつ（スマホ向け） */
export type InputLayout = 'grid' | 'mobile'
const LAYOUT_KEY = 'swim-timer:inputLayout'
const AUTO_NEXT_KEY = 'swim-timer:autoNext'

/** 手動で選んだ形があればそれを、なければ画面の幅で決める（狭ければ1本ずつ） */
export function loadInputLayout(): InputLayout {
  const v = loadSetting(LAYOUT_KEY)
  if (v === 'grid' || v === 'mobile') return v
  try {
    return window.matchMedia('(max-width: 720px)').matches ? 'mobile' : 'grid'
  } catch {
    return 'grid'
  }
}

export function saveInputLayout(layout: InputLayout) {
  saveSetting(LAYOUT_KEY, layout)
}

/** スマホ入力：4桁入力したら自動で次の選手へ（既定は切） */
export function loadAutoNext(): boolean {
  return loadSetting(AUTO_NEXT_KEY) === 'on'
}

export function saveAutoNext(on: boolean) {
  saveSetting(AUTO_NEXT_KEY, on ? 'on' : 'off')
}

export const LANE_ORDER_LABELS: { value: LaneOrder; label: string }[] = [
  { value: 'asc', label: 'レーン昇順（1→5）' },
  { value: 'desc', label: 'レーン降順（5→1）' },
  { value: 'entry', label: '登録順' },
]
