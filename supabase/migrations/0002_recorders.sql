-- =====================================================================
-- スイムタイマー：測定ごとの記録係（0002）
--
-- 使い方：Supabase の画面 → SQL Editor → New query に、このファイルの中身を
--         すべて貼り付けて「Run」を押す。何度実行しても壊れないように書いてある。
--
-- 0001 の表（members / swimmers / sessions / times）はそのまま使い、次を変える。
--
-- 役割（members.role）。0001 と同じく、管理者が「部員」画面で承認・変更する
--   pending : 承認待ち。何も見られない
--   member  : 部員。記録を見られる。その測定の記録係に指名されていれば、入力中の間は入力できる
--   admin   : 管理者。すべての操作ができる（測定の作成、記録係の指名、終了後のタイム修正、部員の承認など）
-- 0001 の「入力担当（recorder）」は、測定ごとの記録係に置き換えるので、部員（member）に読み替える。
--
-- 記録係（sessions.recorder_ids）
--   測定ごとに管理者が指名する（複数人可）。その測定が入力中（in_progress）の間だけ、
--   全員分のタイムの入力・修正、測定の設定の変更、測定の終了ができる。終了後に直せるのは管理者だけ。
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 役割：pending / member / admin（入力担当は部員に読み替える）
-- ---------------------------------------------------------------------

alter table public.members drop constraint if exists members_role_check;
update public.members set role = 'member' where role = 'recorder';
alter table public.members add constraint members_role_check check (role in ('pending', 'member', 'admin'));

-- ---------------------------------------------------------------------
-- 2. 測定：記録係
-- ---------------------------------------------------------------------

alter table public.sessions add column if not exists recorder_ids uuid[] not null default '{}';

-- ---------------------------------------------------------------------
-- 3. 役割を調べる関数（security definer：名簿のルールの中から名簿を読んでも無限に繰り返さない）
-- ---------------------------------------------------------------------

-- 0001 のルールと関数のうち、置き換えるもの
drop policy if exists times_insert on public.times;
drop policy if exists times_update on public.times;
drop policy if exists swimmers_insert on public.swimmers;
drop policy if exists swimmers_update on public.swimmers;
drop policy if exists sessions_insert on public.sessions;
drop policy if exists sessions_update on public.sessions;
drop function if exists public.is_own_cell(uuid, uuid, integer);
drop function if exists public.can_record();
drop function if exists public.my_swimmer_id();

-- my_role()・refresh_my_profile()・部員名簿のルール（管理者だけが変更）は 0001 のまま

-- 承認された人（記録を見られる人）
create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('member', 'admin'), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- 入力中のどれかの測定の記録係か（選手の登録・修正ができる）
create or replace function public.is_active_recorder() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_approved() and exists (
    select 1 from public.sessions s
    where not s.deleted and s.status = 'in_progress' and auth.uid() = any (s.recorder_ids)
  )
$$;

-- タイムの1マスを書いてよいか。
--   管理者：いつでも（終了後も）
--   記録係：その測定が入力中（in_progress）のときだけ
-- どちらも、測定に参加している選手で、本数の範囲内であること
create or replace function public.can_write_time(p_session uuid, p_swimmer uuid, p_rep integer) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sessions s
    where s.id = p_session
      and p_swimmer = any (s.swimmer_ids)
      and p_rep <= s.reps
      and (
        public.is_admin()
        or (public.is_approved() and not s.deleted and s.status = 'in_progress' and auth.uid() = any (s.recorder_ids))
      )
  )
$$;

-- ---------------------------------------------------------------------
-- 4. トリガー：記録係は、記録係の指名と測定の削除を変えられない
-- ---------------------------------------------------------------------

-- アプリ（ログインした人）からの変更か。SQL Editor からの変更は対象外
create or replace function public.is_app_request() returns boolean
language sql stable as $$
  select current_user in ('authenticated', 'anon')
$$;

create or replace function public.guard_sessions() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.is_app_request() and not public.is_admin() and (
       new.recorder_ids is distinct from old.recorder_ids
       or new.deleted is distinct from old.deleted
       or new.created_at is distinct from old.created_at
     ) then
    raise exception '記録係の指名と測定の削除は、管理者だけができます。' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_sessions on public.sessions;
create trigger guard_sessions before update on public.sessions for each row execute function public.guard_sessions();

-- ---------------------------------------------------------------------
-- 5. アクセスのルール（閲覧のルールと名簿のルールは 0001 のまま）
-- ---------------------------------------------------------------------

-- 選手：書けるのは管理者と、入力中の測定の記録係
create policy swimmers_insert on public.swimmers for insert to authenticated
  with check (public.is_admin() or public.is_active_recorder());
create policy swimmers_update on public.swimmers for update to authenticated
  using (public.is_admin() or public.is_active_recorder())
  with check (public.is_admin() or public.is_active_recorder());

-- 測定：作れるのは管理者だけ。変えられるのは管理者と、その測定の記録係（入力中のときだけ。終了もできる）
create policy sessions_insert on public.sessions for insert to authenticated with check (public.is_admin());
create policy sessions_update on public.sessions for update to authenticated
  using (
    public.is_admin()
    or (public.is_approved() and auth.uid() = any (recorder_ids) and status = 'in_progress' and not deleted)
  )
  with check (public.is_admin() or (public.is_approved() and auth.uid() = any (recorder_ids)));

-- タイム：書き込みは can_write_time（測定の状態でロック）
create policy times_insert on public.times for insert to authenticated
  with check (public.can_write_time(session_id, swimmer_id, rep));
create policy times_update on public.times for update to authenticated
  using (public.can_write_time(session_id, swimmer_id, rep))
  with check (public.can_write_time(session_id, swimmer_id, rep));

commit;
