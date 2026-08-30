-- READY current baseline.
-- This is intentionally idempotent so projects that received the early SQL files
-- manually can enter normal migration history without rewriting existing data.

create extension if not exists pgcrypto;

create table if not exists public.ready_students (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 40),
  school text not null check (char_length(trim(school)) between 1 and 80),
  grade text not null check (char_length(trim(grade)) between 1 and 40),
  pin_hash text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ready_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  actor_type text not null check (actor_type in ('student', 'admin')),
  student_id uuid references public.ready_students(id) on delete cascade,
  remembered boolean not null default false,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check ((actor_type = 'student' and student_id is not null) or (actor_type = 'admin' and student_id is null))
);

create table if not exists public.ready_login_attempts (
  id bigint generated always as identity primary key,
  identifier text not null,
  successful boolean not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ready_exams (
  id uuid primary key default gen_random_uuid(),
  school text not null check (char_length(trim(school)) between 1 and 80),
  grade text not null check (char_length(trim(grade)) between 1 and 40),
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ready_passages (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 120),
  source_text text not null check (char_length(trim(source_text)) > 0),
  source_type text not null default 'TEXTBOOK' check (source_type in ('TEXTBOOK', 'MOCK_EXAM')),
  grade text not null check (char_length(trim(grade)) between 1 and 40),
  source_year integer,
  source_month smallint check (source_month between 1 and 12),
  source_label text not null default '',
  display_order integer not null default 0,
  study_status text not null default 'ready' check (study_status in ('pending', 'processing', 'ready', 'failed')),
  translation_source text not null default 'none' check (translation_source in ('none', 'teacher', 'ai')),
  processing_error text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.ready_passage_sentences (
  id uuid primary key default gen_random_uuid(),
  passage_id uuid not null references public.ready_passages(id) on delete cascade,
  sentence_index integer not null check (sentence_index >= 0),
  text text not null check (char_length(trim(text)) > 0),
  translation text not null default '',
  created_at timestamptz not null default now(),
  unique (passage_id, sentence_index)
);

create table if not exists public.ready_questions (
  id uuid primary key default gen_random_uuid(),
  passage_id uuid not null references public.ready_passages(id) on delete cascade,
  type text not null default 'order' check (char_length(type) between 1 and 40),
  difficulty smallint,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'available')),
  generation integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ready_exam_passages (
  exam_id uuid not null references public.ready_exams(id) on delete cascade,
  passage_id uuid not null references public.ready_passages(id) on delete restrict,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (exam_id, passage_id),
  unique (exam_id, position)
);

create table if not exists public.ready_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.ready_students(id) on delete restrict,
  question_id uuid not null references public.ready_questions(id) on delete restrict,
  exam_id uuid not null references public.ready_exams(id) on delete restrict,
  response jsonb not null,
  correct boolean not null,
  elapsed_ms integer not null check (elapsed_ms >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.ready_word_lookup_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.ready_students(id) on delete restrict,
  exam_id uuid not null references public.ready_exams(id) on delete restrict,
  passage_id uuid not null references public.ready_passages(id) on delete restrict,
  sentence_id uuid references public.ready_passage_sentences(id) on delete set null,
  surface_word text not null check (char_length(trim(surface_word)) between 1 and 100),
  normalized_word text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.ready_saved_words (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.ready_students(id) on delete restrict,
  passage_id uuid not null references public.ready_passages(id) on delete restrict,
  sentence_id uuid references public.ready_passage_sentences(id) on delete set null,
  word text not null check (char_length(trim(word)) between 1 and 100),
  normalized_word text not null,
  meaning_snapshot text not null,
  created_at timestamptz not null default now(),
  unique (student_id, passage_id, normalized_word)
);

create table if not exists public.ready_sentence_translation_view_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.ready_students(id) on delete restrict,
  exam_id uuid not null references public.ready_exams(id) on delete restrict,
  passage_id uuid not null references public.ready_passages(id) on delete restrict,
  sentence_id uuid not null references public.ready_passage_sentences(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.ready_saved_sentences (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.ready_students(id) on delete restrict,
  exam_id uuid not null references public.ready_exams(id) on delete restrict,
  passage_id uuid not null references public.ready_passages(id) on delete restrict,
  sentence_id uuid not null references public.ready_passage_sentences(id) on delete restrict,
  source_text_snapshot text not null,
  translation_snapshot text not null,
  created_at timestamptz not null default now(),
  unique (student_id, sentence_id)
);

create table if not exists public.ready_word_cache (
  normalized_word text primary key,
  meaning text not null,
  updated_at timestamptz not null default now()
);

create index if not exists ready_sessions_active_idx on public.ready_sessions(token_hash, expires_at) where revoked_at is null;
create index if not exists ready_login_attempts_recent_idx on public.ready_login_attempts(identifier, created_at desc);
create index if not exists ready_students_school_grade_sort_idx on public.ready_students(school, grade, sort_order, name);
create index if not exists ready_exams_school_grade_idx on public.ready_exams(school, grade, created_at desc);
create index if not exists ready_passages_library_idx on public.ready_passages(grade, source_type, display_order, created_at desc);
create index if not exists ready_exam_passages_passage_idx on public.ready_exam_passages(passage_id, position);
create index if not exists ready_attempts_student_created_idx on public.ready_attempts(student_id, created_at desc);
create index if not exists ready_attempts_question_created_idx on public.ready_attempts(question_id, created_at desc);
create index if not exists ready_attempts_exam_created_idx on public.ready_attempts(exam_id, created_at desc);
create index if not exists ready_word_lookup_student_created_idx on public.ready_word_lookup_events(student_id, created_at desc);
create index if not exists ready_translation_view_student_created_idx on public.ready_sentence_translation_view_events(student_id, created_at desc);
create index if not exists ready_saved_words_student_created_idx on public.ready_saved_words(student_id, created_at desc);
create index if not exists ready_saved_sentences_student_created_idx on public.ready_saved_sentences(student_id, created_at desc);

create or replace function public.ready_attempts_are_immutable()
returns trigger language plpgsql as $$ begin raise exception 'READY attempts are append-only'; end; $$;
drop trigger if exists ready_attempts_no_update on public.ready_attempts;
create trigger ready_attempts_no_update before update or delete on public.ready_attempts for each row execute function public.ready_attempts_are_immutable();

create or replace function public.ready_create_student(p_name text, p_school text, p_grade text, p_pin text, p_sort_order integer default 0)
returns table(id uuid, name text, school text, grade text, sort_order integer, active boolean)
language plpgsql security definer set search_path = public as $$
begin
  if trim(coalesce(p_name, '')) = '' or char_length(trim(p_name)) > 40 then raise exception '학생 이름을 확인해 주세요.'; end if;
  if trim(coalesce(p_school, '')) = '' or char_length(trim(p_school)) > 80 then raise exception '학교를 확인해 주세요.'; end if;
  if trim(coalesce(p_grade, '')) = '' or char_length(trim(p_grade)) > 40 then raise exception '학년을 확인해 주세요.'; end if;
  if coalesce(p_pin, '') !~ '^\d{4,6}$' then raise exception 'PIN은 숫자 4~6자리여야 합니다.'; end if;
  return query insert into public.ready_students(name, school, grade, sort_order, pin_hash)
    values (trim(p_name), trim(p_school), trim(p_grade), coalesce(p_sort_order, 0), extensions.crypt(p_pin, extensions.gen_salt('bf', 10)))
    returning ready_students.id, ready_students.name, ready_students.school, ready_students.grade, ready_students.sort_order, ready_students.active;
end; $$;

create or replace function public.ready_set_student_pin(p_student_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_pin, '') !~ '^\d{4,6}$' then raise exception 'PIN은 숫자 4~6자리여야 합니다.'; end if;
  update ready_students set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)) where id = p_student_id;
  if not found then raise exception '학생을 찾지 못했습니다.'; end if;
  update ready_sessions set revoked_at = now() where actor_type = 'student' and student_id = p_student_id and revoked_at is null;
end; $$;

create or replace function public.ready_verify_student_pin(p_student_id uuid, p_pin text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select active and pin_hash is not null and pin_hash = extensions.crypt(p_pin, pin_hash) from ready_students where id = p_student_id), false);
$$;

alter table public.ready_students enable row level security;
alter table public.ready_sessions enable row level security;
alter table public.ready_login_attempts enable row level security;
alter table public.ready_exams enable row level security;
alter table public.ready_passages enable row level security;
alter table public.ready_passage_sentences enable row level security;
alter table public.ready_questions enable row level security;
alter table public.ready_exam_passages enable row level security;
alter table public.ready_attempts enable row level security;
alter table public.ready_word_lookup_events enable row level security;
alter table public.ready_saved_words enable row level security;
alter table public.ready_sentence_translation_view_events enable row level security;
alter table public.ready_saved_sentences enable row level security;
alter table public.ready_word_cache enable row level security;

revoke all on public.ready_students, public.ready_sessions, public.ready_login_attempts, public.ready_exams,
  public.ready_passages, public.ready_passage_sentences, public.ready_questions, public.ready_exam_passages,
  public.ready_attempts, public.ready_word_lookup_events, public.ready_saved_words,
  public.ready_sentence_translation_view_events, public.ready_saved_sentences, public.ready_word_cache from anon, authenticated;
grant all on public.ready_students, public.ready_sessions, public.ready_login_attempts, public.ready_exams,
  public.ready_passages, public.ready_passage_sentences, public.ready_questions, public.ready_exam_passages,
  public.ready_attempts, public.ready_word_lookup_events, public.ready_saved_words,
  public.ready_sentence_translation_view_events, public.ready_saved_sentences, public.ready_word_cache to service_role;
grant usage, select on sequence public.ready_login_attempts_id_seq to service_role;
revoke all on function public.ready_create_student(text, text, text, text, integer), public.ready_set_student_pin(uuid, text), public.ready_verify_student_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.ready_create_student(text, text, text, text, integer), public.ready_set_student_pin(uuid, text), public.ready_verify_student_pin(uuid, text) to service_role;
