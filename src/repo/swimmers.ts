import { db } from '../db'
import type { Swimmer } from '../domain/types'

export class SwimmerError extends Error {}

export interface SwimmerInput {
  name: string
  grade?: string
}

function normalize(input: SwimmerInput): { name: string; grade?: string } {
  const name = input.name.trim().replace(/\s+/g, ' ')
  const grade = input.grade?.trim() || undefined
  if (name === '') throw new SwimmerError('名前を入力してください。')
  return { name, grade }
}

/** 同じ名前の選手がいないか（入力表で区別できなくなるため禁止） */
async function assertUniqueName(name: string, exceptId?: number) {
  const key = name.toLowerCase()
  const dup = await db.swimmers
    .filter((s) => s.id !== exceptId && s.name.toLowerCase() === key)
    .first()
  if (dup) {
    throw new SwimmerError(
      `「${name}」はすでに登録されています。同じ名前の選手は、イニシャルなどを付けて区別してください。`,
    )
  }
}

/** 登録順で全選手を返す */
export function listSwimmers(): Promise<Swimmer[]> {
  return db.swimmers.orderBy('id').toArray()
}

export async function addSwimmer(input: SwimmerInput): Promise<number> {
  const data = normalize(input)
  return db.transaction('rw', db.swimmers, async () => {
    await assertUniqueName(data.name)
    return (await db.swimmers.add(data)) as number
  })
}

export async function updateSwimmer(id: number, input: SwimmerInput): Promise<void> {
  const data = normalize(input)
  await db.transaction('rw', db.swimmers, async () => {
    await assertUniqueName(data.name, id)
    const n = await db.swimmers.update(id, { name: data.name, grade: data.grade })
    if (n === 0 && !(await db.swimmers.get(id))) throw new SwimmerError('選手が見つかりません。')
  })
}

/** その選手の記録（タイム・参加した測定）があるか */
export async function hasRecords(id: number): Promise<boolean> {
  const times = await db.times.where('swimmerId').equals(id).count()
  if (times > 0) return true
  const sessions = await db.sessions.filter((s) => s.swimmerIds.includes(id)).count()
  return sessions > 0
}

/**
 * 選手を削除する。過去の記録がある選手は削除できない
 * （記録が消えたり、名前のないタイムが残ったりするのを防ぐ）。
 */
export async function deleteSwimmer(id: number): Promise<void> {
  await db.transaction('rw', db.swimmers, db.times, db.sessions, async () => {
    if (await hasRecords(id)) {
      throw new SwimmerError('過去の記録があるため削除できません。')
    }
    await db.swimmers.delete(id)
  })
}
