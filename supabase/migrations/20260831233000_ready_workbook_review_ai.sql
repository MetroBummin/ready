-- Workbook exercise review and persisted-before-inference AI grading.

create table if not exists public.ready_workbook_bookmarks (
  student_id uuid not null references public.ready_students(id) on delete restrict,
  exam_id uuid not null references public.ready_exams(id) on delete restrict,
  passage_id uuid not null references public.ready_passages(id) on delete restrict,
  workbook_key text not null check (char_length(workbook_key) between 1 and 120),
  item_key text not null check (char_length(item_key) between 1 and 120),
  item_type text not null check (char_length(item_type) between 1 and 60),
  source text not null default 'manual' check (source in ('manual', 'wrong_answer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, exam_id, passage_id, workbook_key, item_key)
);

create index if not exists ready_workbook_bookmarks_review_idx
  on public.ready_workbook_bookmarks(student_id, exam_id, updated_at desc);

create table if not exists public.ready_workbook_ai_grading_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.ready_students(id) on delete restrict,
  exam_id uuid not null references public.ready_exams(id) on delete restrict,
  passage_id uuid not null references public.ready_passages(id) on delete restrict,
  workbook_key text not null check (char_length(workbook_key) between 1 and 120),
  item_key text not null check (char_length(item_key) between 1 and 120),
  response jsonb not null,
  rubric_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ready_workbook_ai_grading_student_idx
  on public.ready_workbook_ai_grading_requests(student_id, created_at desc);

alter table public.ready_workbook_bookmarks enable row level security;
alter table public.ready_workbook_ai_grading_requests enable row level security;
revoke all on public.ready_workbook_bookmarks, public.ready_workbook_ai_grading_requests from anon, authenticated;
grant all on public.ready_workbook_bookmarks, public.ready_workbook_ai_grading_requests to service_role;

create or replace function public.ready_delete_student_cascade(p_student_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from ready_students where id=p_student_id) then raise exception '학생을 찾지 못했습니다.'; end if;
  perform set_config('ready.allow_cascade_delete','on',true);
  delete from ready_workbook_bookmarks where student_id=p_student_id;
  delete from ready_workbook_ai_grading_requests where student_id=p_student_id;
  delete from ready_question_bookmarks where student_id=p_student_id;
  delete from ready_ai_grading_requests where student_id=p_student_id;
  delete from ready_workbook_attempts where student_id=p_student_id;
  delete from ready_attempts where student_id=p_student_id;
  delete from ready_saved_words where student_id=p_student_id;
  delete from ready_word_states where student_id=p_student_id;
  delete from ready_saved_sentences where student_id=p_student_id;
  delete from ready_word_lookup_events where student_id=p_student_id;
  delete from ready_sentence_translation_view_events where student_id=p_student_id;
  delete from ready_sessions where student_id=p_student_id;
  delete from ready_login_attempts where identifier='student:'||p_student_id::text;
  delete from ready_students where id=p_student_id;
end $$;

create or replace function public.ready_delete_passage_cascade(p_passage_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_question_ids uuid[];
begin
  if not exists(select 1 from ready_passages where id=p_passage_id) then raise exception '지문을 찾지 못했습니다.'; end if;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_question_ids from ready_questions where passage_id=p_passage_id;
  perform set_config('ready.allow_cascade_delete','on',true);
  delete from ready_workbook_bookmarks where passage_id=p_passage_id;
  delete from ready_workbook_ai_grading_requests where passage_id=p_passage_id;
  delete from ready_workbook_attempts where passage_id=p_passage_id;
  delete from ready_question_bookmarks where question_id=any(v_question_ids);
  delete from ready_ai_grading_requests where question_id=any(v_question_ids);
  delete from ready_attempts where question_id=any(v_question_ids);
  delete from ready_saved_words where passage_id=p_passage_id;
  delete from ready_word_states where passage_id=p_passage_id;
  delete from ready_saved_sentences where passage_id=p_passage_id;
  delete from ready_word_lookup_events where passage_id=p_passage_id;
  delete from ready_sentence_translation_view_events where passage_id=p_passage_id;
  delete from ready_exam_passages where passage_id=p_passage_id;
  if to_regclass('public.ready_publication_questions') is not null then
    execute 'delete from public.ready_publication_questions where question_id=any($1)' using v_question_ids;
  end if;
  delete from ready_questions where passage_id=p_passage_id;
  delete from ready_passages where id=p_passage_id;
end $$;

revoke all on function public.ready_delete_student_cascade(uuid), public.ready_delete_passage_cascade(uuid) from public,anon,authenticated;
grant execute on function public.ready_delete_student_cascade(uuid), public.ready_delete_passage_cascade(uuid) to service_role;
