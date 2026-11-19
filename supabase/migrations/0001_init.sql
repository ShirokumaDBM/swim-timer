-- =====================================================================
-- スイムタイマー：クラウドのデータベース（Supabase）
--
-- 使い方：Supabase の画面 → SQL Editor → New query に、このファイルの中身を
--         すべて貼り付けて「Run」を押す。何度実行しても壊れないように書いてある。
--
-- 役割（members.role）
--   pending  : 承認待ち。何も見られない
--   member   : 部員。記録を見られる。自分に結び付いた選手のタイムだけ追加・修正できる
--   recorder : 入力担当。すべての選手・測定・タイムを書ける
--   admin    : 管理者。入力担当にできることに加えて、部員の承認・役割の変更ができる
-- 最初にログインした人が管理者になる（このファイルを実行したら、すぐに管理者がログインすること）。
-- =====================================================================

-- ---------- 表 ----------

-- 部員名簿（Discord アカウント 1つにつき 1行。初めてログインしたときに自動で作られる）
create table if not exists public.members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url   text,
  role         text not null default 'pending' check (role in ('pending', 'member', 'recorder', 'admin')),
  -- この部員本人の選手（部員が自分のタイムを修正するときに使う）
  swimmer_id   uuid,
  created_at   timestamptz not null default now()
);

-- 選手
create table if not exists public.swimmers (
  id         uuid primary key,
  name       text not null check (length(btrim(name)) > 0),
  grade      text,
  -- 登録日時（ms）。一覧の並び順に使う
  created_at bigint not null,
  -- 削除した選手（端末どうしで削除を伝えるため、行は消さずに印を付ける）
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- 測定
create table if not exists public.sessions (
  id          uuid primary key,
  date        text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  distance    integer not null check (distance > 0),
  reps        integer not null check (reps between 1 and 100),
  stroke      text,
  circle      text,
  memo        text,
  swimmer_ids uuid[] not null,
  -- 各選手のレーン（swimmer_ids と同じ並び。未設定は null）
  lanes       integer[],
  status      text not null check (status in ('in_progress', 'finished')),
  created_at  bigint not null,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- タイム（測定・選手・何本目 の 1マスにつき 1行）
create table if not exists public.times (
  session_id uuid not null references public.sessions (id),
  swimmer_id uuid not null references public.swimmers (id),
  rep        integer not null check (rep >= 1),
  -- 1/100秒。null = 休んだ本
  centis     integer check (centis > 0),
  -- 未入力に戻したマス（端末どうしで消去を伝えるため、行は消さずに印を付ける）
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (session_id, swimmer_id, rep)
);

create index if not exists swimmers_updated_at on public.swimmers (updated_at);
create index if not exists sessions_updated_at on public.sessions (updated_at);
create index if not exists times_updated_at on public.times (updated_at);

-- ---------- 更新日時・更新者を自動で入れる ----------

create or replace function public.touch_row() returns trigger
language plpgsql set search_path = public as $$
begin
  -- 受け取り側は「前回受け取った時刻より後に変わった行」を取りに来るので、時刻はサーバーで決める
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists touch_swimmers on public.swimmers;
create trigger touch_swimmers before insert or update on public.swimmers for each row execute function public.touch_row();
drop trigger if exists touch_sessions on public.sessions;
create trigger touch_sessions before insert or update on public.sessions for each row execute function public.touch_row();
drop trigger if exists touch_times on public.times;
create trigger touch_times before insert or update on public.times for each row execute function public.touch_row();

-- ---------- 役割を調べる関数（アクセスのルールの中で使う） ----------

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = auth.uid()
$$;

create or replace function public.my_swimmer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select swimmer_id from public.members where user_id = auth.uid()
$$;

-- 承認された人（記録を見られる人）
create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('member', 'recorder', 'admin'), false)
$$;

-- 全員分を書ける人
create or replace function public.can_record() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('recorder', 'admin'), false)
$$;

-- 部員が、自分のタイムとして書いてよいマスか（参加している測定・本数の範囲内・自分の選手）
create or replace function public.is_own_cell(p_session uuid, p_swimmer uuid, p_rep integer) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'member', false)
     and p_swimmer = public.my_swimmer_id()
     and exists (
       select 1 from public.sessions s
       where s.id = p_session and not s.deleted and p_swimmer = any (s.swimmer_ids) and p_rep <= s.reps
     )
$$;

-- ---------- 初めてログインした人を名簿に入れる ----------

-- Discord の表示名（サーバーでのニックネームではなく、アカウントの表示名）
create or replace function public.discord_name(meta jsonb) returns text
language sql immutable as $$
  select coalesce(
    nullif(meta -> 'custom_claims' ->> 'global_name', ''),
    nullif(meta ->> 'full_name', ''),
    nullif(meta ->> 'name', ''),
    nullif(meta ->> 'user_name', ''),
    ''
  )
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- 同時に2人が初めてログインしても、管理者が2人にならないようにする
  perform pg_advisory_xact_lock(hashtext('swim-timer:first-admin'));
  insert into public.members (user_id, display_name, avatar_url, role)
  values (
    new.id,
    public.discord_name(new.raw_user_meta_data),
    new.raw_user_meta_data ->> 'avatar_url',
    case when exists (select 1 from public.members where role = 'admin') then 'pending' else 'admin' end
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- このファイルを実行する前にログインしていた人も名簿に入れる（いちばん早くログインした人を管理者に）
insert into public.members (user_id, display_name, avatar_url, role)
select u.id, public.discord_name(u.raw_user_meta_data), u.raw_user_meta_data ->> 'avatar_url', 'pending'
from auth.users u
on conflict (user_id) do nothing;

update public.members set role = 'admin'
where user_id = (select u.id from auth.users u join public.members m on m.user_id = u.id order by u.created_at limit 1)
  and not exists (select 1 from public.members where role = 'admin');

-- 管理者が1人もいなくなる変更は受け付けない（誰も承認できなくなるため）
create or replace function public.keep_one_admin() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.role = 'admin' and new.role <> 'admin'
     and not exists (select 1 from public.members where role = 'admin' and user_id <> old.user_id) then
    raise exception '管理者が1人もいなくなるため変更できません。先にほかの人を管理者にしてください。';
  end if;
  if new.user_id <> old.user_id then
    raise exception '部員のアカウントは変更できません。';
  end if;
  return new;
end $$;

drop trigger if exists keep_one_admin on public.members;
create trigger keep_one_admin before update on public.members for each row execute function public.keep_one_admin();

-- ---------- アクセスのルール（行ごとのアクセス制御） ----------

alter table public.members  enable row level security;
alter table public.swimmers enable row level security;
alter table public.sessions enable row level security;
alter table public.times    enable row level security;

-- 部員名簿：自分の行は誰でも見られる（承認待ちかどうかを知るため）。全員分は管理者だけ
drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using (user_id = auth.uid() or public.my_role() = 'admin');
drop policy if exists members_update on public.members;
create policy members_update on public.members for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- 選手・測定：承認された人は見られる。書けるのは入力担当・管理者
drop policy if exists swimmers_select on public.swimmers;
create policy swimmers_select on public.swimmers for select to authenticated using (public.is_approved());
drop policy if exists swimmers_insert on public.swimmers;
create policy swimmers_insert on public.swimmers for insert to authenticated with check (public.can_record());
drop policy if exists swimmers_update on public.swimmers;
create policy swimmers_update on public.swimmers for update to authenticated
  using (public.can_record()) with check (public.can_record());

drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions for select to authenticated using (public.is_approved());
drop policy if exists sessions_insert on public.sessions;
create policy sessions_insert on public.sessions for insert to authenticated with check (public.can_record());
drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions for update to authenticated
  using (public.can_record()) with check (public.can_record());

-- タイム：承認された人は見られる。入力担当・管理者は全員分、部員は自分のマスだけ書ける
drop policy if exists times_select on public.times;
create policy times_select on public.times for select to authenticated using (public.is_approved());
drop policy if exists times_insert on public.times;
create policy times_insert on public.times for insert to authenticated
  with check (public.can_record() or public.is_own_cell(session_id, swimmer_id, rep));
drop policy if exists times_update on public.times;
create policy times_update on public.times for update to authenticated
  using (public.can_record() or public.is_own_cell(session_id, swimmer_id, rep))
  with check (public.can_record() or public.is_own_cell(session_id, swimmer_id, rep));

-- 行の削除はさせない（削除は deleted の印で伝える）。ログインしていない人には何も見せない
revoke all on public.members, public.swimmers, public.sessions, public.times from anon;
grant select, update on public.members to authenticated;
grant select, insert, update on public.swimmers, public.sessions, public.times to authenticated;
revoke delete on public.members, public.swimmers, public.sessions, public.times from authenticated;

-- 部員は自分の行の役割・選手を変えられない（名簿を変えられるのは管理者だけ。上のルールで制限済み）。
-- 表示名とアイコンは、ログインのたびにアプリが Discord の最新の値で更新する
create or replace function public.refresh_my_profile() returns void
language sql security definer set search_path = public as $$
  update public.members m
  set display_name = public.discord_name(u.raw_user_meta_data),
      avatar_url = u.raw_user_meta_data ->> 'avatar_url'
  from auth.users u
  where m.user_id = auth.uid() and u.id = m.user_id
$$;

revoke execute on function public.refresh_my_profile() from public, anon;
grant execute on function public.refresh_my_profile() to authenticated;

-- ---------- リアルタイム更新（ほかの端末の変更をすぐに受け取る） ----------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'swimmers') then
      alter publication supabase_realtime add table public.swimmers;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sessions') then
      alter publication supabase_realtime add table public.sessions;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'times') then
      alter publication supabase_realtime add table public.times;
    end if;
  end if;
end $$;
