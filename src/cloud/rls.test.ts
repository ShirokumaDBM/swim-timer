/**
 * クラウドのデータベースのアクセスのルールのテスト。
 * 手元で PostgreSQL（PGlite）を動かし、本番と同じく 0001 → 0002 の順に実行してから、
 * 役割ごとに「できること・できないこと」を確かめる。
 */
import { PGlite } from '@electric-sql/pglite'
import M0001 from '../../supabase/migrations/0001_init.sql?raw'
import M0002 from '../../supabase/migrations/0002_recorders.sql?raw'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/** Supabase にある部品のうち、テストに必要なものだけを用意する */
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    raw_user_meta_data jsonb not null default '{}',
    created_at timestamptz not null default clock_timestamp()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`

const U = {
  admin: 'a0000000-0000-0000-0000-000000000001',
  admin2: 'a0000000-0000-0000-0000-000000000002',
  recorder: 'a0000000-0000-0000-0000-000000000003',
  yamada: 'a0000000-0000-0000-0000-000000000004',
  stranger: 'a0000000-0000-0000-0000-000000000005',
}
const W = {
  yamada: 'b0000000-0000-0000-0000-000000000001',
  sato: 'b0000000-0000-0000-0000-000000000002',
}
const OPEN = 'c0000000-0000-0000-0000-000000000001' // 入力中。記録係は recorder
const DONE = 'c0000000-0000-0000-0000-000000000002' // 終了済み。記録係は recorder

type Row = Record<string, unknown>
let pg: PGlite
const rows = async (q: string, params: unknown[] = []) => (await pg.query<Row>(q, params)).rows
const one = async (q: string, params: unknown[] = []) => (await rows(q, params))[0]

async function newDb() {
  const db = await PGlite.create()
  await db.exec(SUPABASE_STUB)
  await db.exec(M0001)
  return db
}

/** その人としてログインした状態で実行する（null ならログインしていない人） */
async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await pg.exec(user ? 'set role authenticated' : 'set role anon')
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? ''])
  try {
    return await fn()
  } finally {
    await pg.exec('reset role')
    await pg.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}

const signUp = (db: PGlite, id: string, name: string) =>
  db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [
    id,
    JSON.stringify({ full_name: name, provider_id: `discord-${name}`, avatar_url: `https://cdn/${name}.png` }),
  ])

/** 役割を変える（管理者が SQL Editor から変えるのと同じ） */
const setRole = (user: string, role: string) => pg.query(`update public.members set role = $2 where user_id = $1`, [user, role])

const setTime = (swimmer: string, rep: number, centis: number | null, session = OPEN) =>
  pg.query(
    `insert into public.times (session_id, swimmer_id, rep, centis) values ($1, $2, $3, $4)
     on conflict (session_id, swimmer_id, rep) do update set centis = excluded.centis, deleted = false`,
    [session, swimmer, rep, centis],
  )
const timeOf = async (swimmer: string, rep: number, session = OPEN) =>
  (await one(`select centis from public.times where session_id = $1 and swimmer_id = $2 and rep = $3`, [session, swimmer, rep]))?.centis
const roleOf = async (user: string) => (await one(`select role from public.members where user_id = $1`, [user]))?.role

beforeAll(async () => {
  pg = await newDb()
  await pg.exec(M0002)
}, 60_000)

afterAll(() => pg.close())

beforeEach(async () => {
  await pg.exec(`truncate public.times, public.sessions, public.swimmers, public.members, auth.users cascade`)
  for (const [k, id] of Object.entries(U)) await signUp(pg, id, k)
  // 最初の人（admin）は自動で管理者。ほかは承認待ちから始まる
  await setRole(U.admin2, 'admin')
  await setRole(U.recorder, 'member')
  await setRole(U.yamada, 'member')
  // 管理者が選手と測定を作り、記録係を指名する
  await as(U.admin, async () => {
    await pg.query(`insert into public.swimmers (id, name, created_at) values ($1, '山田', 1), ($2, '佐藤', 2)`, [W.yamada, W.sato])
    await pg.query(
      `insert into public.sessions (id, date, distance, reps, swimmer_ids, status, created_at, recorder_ids)
       values ($1, '2026-11-20', 50, 3, array[$3, $4]::uuid[], 'in_progress', 100, array[$5]::uuid[]),
              ($2, '2026-11-13', 50, 3, array[$3, $4]::uuid[], 'finished', 90, array[$5]::uuid[])`,
      [OPEN, DONE, W.yamada, W.sato, U.recorder],
    )
    await setTime(W.yamada, 1, 3800, DONE)
  })
})

// ---------------------------------------------------------------------

describe('0001 からの切り替え', () => {
  it('0001 の入力担当は部員に読み替える（承認待ち・部員・管理者はそのまま）', async () => {
    const db = await newDb()
    await signUp(db, U.admin, 'admin') // 0001 では最初の人が管理者
    await signUp(db, U.recorder, 'recorder')
    await signUp(db, U.yamada, 'yamada')
    await signUp(db, U.stranger, 'stranger')
    await db.query(`update public.members set role = 'recorder' where user_id = $1`, [U.recorder])
    await db.query(`update public.members set role = 'member' where user_id = $1`, [U.yamada])
    await db.exec(M0002)
    const r = (await db.query<Row>(`select user_id, role from public.members order by user_id`)).rows
    expect(r.map((x) => x.role)).toEqual(['admin', 'member', 'member', 'pending'])
    await expect(db.query(`update public.members set role = 'recorder' where user_id = $1`, [U.yamada])).rejects.toThrow(
      /check constraint/,
    )
    await db.close()
  }, 60_000)

  it('以前の試作（新しい人を none で登録する版）が残っていても、0002 の後は新しい人がログインできる', async () => {
    const db = await newDb()
    await signUp(db, U.admin, 'admin')
    // 試作版の状態を再現：役割 none を許し、新しい人を none で登録し、役割の変更を止めるトリガーがある
    await db.exec(`
      alter table public.members drop constraint members_role_check;
      alter table public.members add constraint members_role_check check (role in ('none', 'member', 'admin'));
      update public.members set role = 'admin';
      create or replace function public.handle_new_user() returns trigger
      language plpgsql security definer set search_path = public as $f$
      begin
        insert into public.members (user_id, display_name, role) values (new.id, '', 'none');
        return new;
      end $f$;
      create function public.guard_members() returns trigger language plpgsql as $f$
      begin raise exception 'blocked'; end $f$;
      create trigger guard_members before update on public.members for each row execute function public.guard_members();
    `)
    await signUp(db, U.yamada, 'yamada')
    await db.exec(M0002)
    await signUp(db, U.stranger, 'stranger')
    const r = (await db.query<Row>(`select user_id, role, display_name from public.members order by user_id`)).rows
    expect(r).toEqual([
      { user_id: U.admin, role: 'admin', display_name: 'admin' },
      { user_id: U.yamada, role: 'pending', display_name: '' },
      { user_id: U.stranger, role: 'pending', display_name: 'stranger' },
    ])
    // 管理者が承認できる（役割の変更を止めるトリガーは片付いている）
    await db.query(`update public.members set role = 'member' where user_id = $1`, [U.yamada])
    await db.close()
  }, 60_000)

  it('0002 を2回実行しても壊れない（記録・役割はそのまま）', async () => {
    await pg.exec(M0002)
    expect(await roleOf(U.admin)).toBe('admin')
    expect(await one(`select count(*)::int as n from public.sessions`)).toEqual({ n: 2 })
    expect(await one(`select recorder_ids from public.sessions where id = $1`, [OPEN])).toEqual({ recorder_ids: [U.recorder] })
  })
})

describe('承認（管理者が手で行う）', () => {
  it('最初にログインした人は管理者、2人目からは承認待ち', async () => {
    expect(await roleOf(U.admin)).toBe('admin')
    expect(await roleOf(U.stranger)).toBe('pending')
  })

  it('管理者が承認すると記録を見られる。承認を取り消すと見られなくなる', async () => {
    await as(U.stranger, async () => expect(await rows(`select id from public.sessions`)).toEqual([]))
    await as(U.admin, () => pg.query(`update public.members set role = 'member' where user_id = $1`, [U.stranger]))
    await as(U.stranger, async () => expect(await rows(`select id from public.sessions`)).toHaveLength(2))
    await as(U.admin2, () => pg.query(`update public.members set role = 'pending' where user_id = $1`, [U.stranger]))
    await as(U.stranger, async () => expect(await rows(`select id from public.sessions`)).toEqual([]))
  })

  it('部員は名簿を変えられない（自分の役割も）', async () => {
    await as(U.yamada, async () => {
      expect((await pg.query(`update public.members set role = 'admin' where user_id = $1`, [U.yamada])).affectedRows).toBe(0)
      expect((await pg.query(`update public.members set role = 'member' where user_id = $1`, [U.stranger])).affectedRows).toBe(0)
    })
    expect(await roleOf(U.yamada)).toBe('member')
    expect(await roleOf(U.stranger)).toBe('pending')
  })

  it('管理者が1人もいなくなる変更はできない', async () => {
    await setRole(U.admin2, 'member')
    await as(U.admin, async () => {
      await expect(pg.query(`update public.members set role = 'member' where user_id = $1`, [U.admin])).rejects.toThrow(
        /管理者が1人もいなくなる/,
      )
    })
  })
})

describe('承認待ち・ログインしていない人', () => {
  it('承認待ちの人は、自分の名簿の行だけ見られて、記録は何も見られない・書けない', async () => {
    await as(U.stranger, async () => {
      expect(await rows(`select user_id, role from public.members`)).toEqual([{ user_id: U.stranger, role: 'pending' }])
      for (const t of ['swimmers', 'sessions', 'times']) expect(await rows(`select * from public.${t}`)).toEqual([])
      await expect(setTime(W.yamada, 1, 3800)).rejects.toThrow(/row-level security/)
    })
  })

  it('ログインしていない人は、表そのものを読めない', async () => {
    await as(null, async () => {
      await expect(pg.query(`select * from public.swimmers`)).rejects.toThrow(/permission denied/)
    })
  })
})

describe('部員（記録係でない）', () => {
  it('記録を見られる', async () => {
    await as(U.yamada, async () => {
      expect((await rows(`select name from public.swimmers order by created_at`)).map((r) => r.name)).toEqual(['山田', '佐藤'])
      expect(await rows(`select id from public.sessions`)).toHaveLength(2)
      expect(await rows(`select centis from public.times`)).toEqual([{ centis: 3800 }])
    })
  })

  it('タイム・選手・測定は書けない（自分の選手のタイムも）', async () => {
    await as(U.admin, () => pg.query(`update public.members set swimmer_id = $2 where user_id = $1`, [U.yamada, W.yamada]))
    await as(U.yamada, async () => {
      await expect(setTime(W.yamada, 1, 3800)).rejects.toThrow(/row-level security/)
      await expect(pg.query(`insert into public.swimmers (id, name, created_at) values (gen_random_uuid(), 'x', 3)`)).rejects.toThrow(
        /row-level security/,
      )
      await expect(
        pg.query(
          `insert into public.sessions (id, date, distance, reps, swimmer_ids, status, created_at)
           values (gen_random_uuid(), '2026-12-01', 50, 3, '{}', 'in_progress', 1)`,
        ),
      ).rejects.toThrow(/row-level security/)
      expect((await pg.query(`update public.sessions set memo = 'x'`)).affectedRows).toBe(0)
    })
  })
})

describe('記録係（測定ごとに指名）', () => {
  it('担当の測定が入力中の間は、全員分のタイムを入力・修正・消去できる', async () => {
    await as(U.recorder, async () => {
      await setTime(W.yamada, 1, 3852)
      await setTime(W.sato, 1, null)
      await setTime(W.yamada, 1, 3850)
      await pg.query(`update public.times set deleted = true where session_id = $1 and swimmer_id = $2`, [OPEN, W.sato])
    })
    expect(await timeOf(W.yamada, 1)).toBe(3850)
    expect(await one(`select deleted from public.times where session_id = $1 and swimmer_id = $2`, [OPEN, W.sato])).toEqual({ deleted: true })
  })

  it('終了した測定のタイムは直せない', async () => {
    await as(U.recorder, async () => {
      await expect(setTime(W.yamada, 1, 3700, DONE)).rejects.toThrow(/row-level security/)
    })
    expect(await timeOf(W.yamada, 1, DONE)).toBe(3800)
  })

  it('参加していない選手・本数の範囲外には書けない', async () => {
    await as(U.admin, () =>
      pg.query(`insert into public.swimmers (id, name, created_at) values ('b0000000-0000-0000-0000-000000000009', '他', 9)`),
    )
    await as(U.recorder, async () => {
      await expect(setTime('b0000000-0000-0000-0000-000000000009', 1, 3800)).rejects.toThrow(/row-level security/)
      await expect(setTime(W.yamada, 4, 3800)).rejects.toThrow(/row-level security/)
    })
  })

  it('担当の測定の設定を変えて、終了できる。終了後は変えられない', async () => {
    await as(U.recorder, async () => {
      await pg.query(`update public.sessions set memo = '雨', reps = 4 where id = $1`, [OPEN])
      await pg.query(`update public.sessions set status = 'finished' where id = $1`, [OPEN])
      expect((await pg.query(`update public.sessions set memo = '終了後' where id = $1`, [OPEN])).affectedRows).toBe(0)
      await expect(setTime(W.yamada, 2, 3900)).rejects.toThrow(/row-level security/)
    })
    expect(await one(`select memo, reps, status from public.sessions where id = $1`, [OPEN])).toEqual({
      memo: '雨',
      reps: 4,
      status: 'finished',
    })
  })

  it('記録係の指名と測定の削除は変えられない', async () => {
    await as(U.recorder, async () => {
      await expect(
        pg.query(`update public.sessions set recorder_ids = array[$2, $3]::uuid[] where id = $1`, [OPEN, U.recorder, U.yamada]),
      ).rejects.toThrow(/管理者だけ/)
      await expect(pg.query(`update public.sessions set deleted = true where id = $1`, [OPEN])).rejects.toThrow(/管理者だけ/)
    })
  })

  it('入力中の測定の記録係の間は、選手を登録・修正できる。担当の測定が終わるとできない', async () => {
    await as(U.recorder, async () => {
      await pg.query(`insert into public.swimmers (id, name, created_at) values ('b0000000-0000-0000-0000-00000000000a', '新入部員', 5)`)
      await pg.query(`update public.swimmers set grade = '1年' where name = '新入部員'`)
    })
    await as(U.admin, () => pg.query(`update public.sessions set status = 'finished' where id = $1`, [OPEN]))
    await as(U.recorder, async () => {
      await expect(pg.query(`insert into public.swimmers (id, name, created_at) values (gen_random_uuid(), 'x', 6)`)).rejects.toThrow(
        /row-level security/,
      )
    })
  })

  it('記録係に指名されていても、承認を取り消されると書けない', async () => {
    await setRole(U.recorder, 'pending')
    await as(U.recorder, async () => {
      await expect(setTime(W.yamada, 1, 3852)).rejects.toThrow(/row-level security/)
    })
  })
})

describe('管理者', () => {
  it('測定を作って記録係を指名でき、あとから記録係を変えられる', async () => {
    const id = 'c0000000-0000-0000-0000-000000000003'
    await as(U.admin, async () => {
      await pg.query(
        `insert into public.sessions (id, date, distance, reps, swimmer_ids, status, created_at, recorder_ids)
         values ($1, '2026-11-27', 50, 3, array[$2]::uuid[], 'in_progress', 110, array[$3]::uuid[])`,
        [id, W.yamada, U.yamada],
      )
    })
    // 指名された山田は入力できる
    await as(U.yamada, () => setTime(W.yamada, 1, 3900, id))
    // 記録係から外すと、入力できなくなる
    await as(U.admin2, () => pg.query(`update public.sessions set recorder_ids = '{}' where id = $1`, [id]))
    await as(U.yamada, async () => {
      await expect(setTime(W.yamada, 2, 3900, id)).rejects.toThrow(/row-level security/)
    })
  })

  it('終了した測定のタイムも直せる。測定の削除の印も付けられる', async () => {
    await as(U.admin, async () => {
      await setTime(W.yamada, 1, 3790, DONE)
      await pg.query(`update public.sessions set deleted = true where id = $1`, [DONE])
    })
    expect(await timeOf(W.yamada, 1, DONE)).toBe(3790)
  })

  it('名簿の全員を見られる', async () => {
    await as(U.admin, async () => expect(await rows(`select user_id from public.members`)).toHaveLength(5))
  })
})
