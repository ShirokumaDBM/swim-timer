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

export const LANE_ORDER_LABELS: { value: LaneOrder; label: string }[] = [
  { value: 'asc', label: 'レーン昇順（1→5）' },
  { value: 'desc', label: 'レーン降順（5→1）' },
  { value: 'entry', label: '登録順' },
]
