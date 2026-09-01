-- Student-facing READY uses one administrator-assigned code. The deterministic
-- fingerprint supports a unique lookup without storing the six-digit code;
-- bcrypt remains the verifier and changing a code revokes existing sessions.

alter table public.ready_students
  add column if not exists login_code_fingerprint text;

alter table public.ready_students
  drop constraint if exists ready_students_login_code_fingerprint_check;
alter table public.ready_students
  add constraint ready_students_login_code_fingerprint_check
  check (login_code_fingerprint is null or login_code_fingerprint ~ '^[0-9a-f]{64}$');

create unique index if not exists ready_students_login_code_fingerprint_key
  on public.ready_students(login_code_fingerprint)
  where login_code_fingerprint is not null;

create or replace function public.ready_create_student_with_code(
  p_name text,
  p_school text,
  p_grade text,
  p_code text,
  p_code_fingerprint text,
  p_sort_order integer default 0
)
returns table(id uuid, name text, school text, grade text, sort_order integer, active boolean)
language plpgsql security definer set search_path = public as $$
begin
  if trim(coalesce(p_name, '')) = '' or char_length(trim(p_name)) > 40 then raise exception '학생 이름을 확인해 주세요.'; end if;
  if trim(coalesce(p_school, '')) = '' or char_length(trim(p_school)) > 80 then raise exception '학교를 확인해 주세요.'; end if;
  if trim(coalesce(p_grade, '')) = '' or char_length(trim(p_grade)) > 40 then raise exception '학년을 확인해 주세요.'; end if;
  if coalesce(p_code, '') !~ '^\d{6}$' then raise exception '학생 코드는 숫자 6자리여야 합니다.'; end if;
  if coalesce(p_code_fingerprint, '') !~ '^[0-9a-f]{64}$' then raise exception '학생 코드 fingerprint가 올바르지 않습니다.'; end if;
  begin
    return query insert into public.ready_students(name, school, grade, sort_order, pin_hash, login_code_fingerprint)
      values (trim(p_name), trim(p_school), trim(p_grade), coalesce(p_sort_order, 0), extensions.crypt(p_code, extensions.gen_salt('bf', 10)), p_code_fingerprint)
      returning ready_students.id, ready_students.name, ready_students.school, ready_students.grade, ready_students.sort_order, ready_students.active;
  exception when unique_violation then
    raise exception '이미 사용 중인 학생 코드입니다.' using errcode = '23505';
  end;
end; $$;

create or replace function public.ready_set_student_code(p_student_id uuid, p_code text, p_code_fingerprint text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_updated integer := 0;
begin
  if coalesce(p_code, '') !~ '^\d{6}$' then raise exception '학생 코드는 숫자 6자리여야 합니다.'; end if;
  if coalesce(p_code_fingerprint, '') !~ '^[0-9a-f]{64}$' then raise exception '학생 코드 fingerprint가 올바르지 않습니다.'; end if;
  begin
    update ready_students
      set pin_hash = extensions.crypt(p_code, extensions.gen_salt('bf', 10)),
          login_code_fingerprint = p_code_fingerprint
      where id = p_student_id;
    get diagnostics v_updated = row_count;
  exception when unique_violation then
    raise exception '이미 사용 중인 학생 코드입니다.' using errcode = '23505';
  end;
  if v_updated = 0 then raise exception '학생을 찾지 못했습니다.'; end if;
  update ready_sessions set revoked_at = now()
    where actor_type = 'student' and student_id = p_student_id and revoked_at is null;
end; $$;

create or replace function public.ready_verify_student_code(p_code_fingerprint text, p_code text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from ready_students
  where active
    and login_code_fingerprint = p_code_fingerprint
    and pin_hash is not null
    and pin_hash = extensions.crypt(p_code, pin_hash)
  limit 1;
$$;

revoke all on function public.ready_create_student_with_code(text,text,text,text,text,integer),
  public.ready_set_student_code(uuid,text,text), public.ready_verify_student_code(text,text)
  from public, anon, authenticated;
grant execute on function public.ready_create_student_with_code(text,text,text,text,text,integer),
  public.ready_set_student_code(uuid,text,text), public.ready_verify_student_code(text,text)
  to service_role;
