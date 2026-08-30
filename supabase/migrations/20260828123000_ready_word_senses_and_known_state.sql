-- READY lexical state mirrors Breeze's learning semantics without importing its
-- EPUB/PDF sync lifecycle: one lemma can retain several saved meanings, while
-- "known" is a separate, reversible per-passage state.

alter table public.ready_saved_words
  add column if not exists meaning_key text;

update public.ready_saved_words
set meaning_key = left(lower(regexp_replace(trim(meaning_snapshot), '\\s+', ' ', 'g')), 500)
where meaning_key is null or meaning_key = '';

alter table public.ready_saved_words
  alter column meaning_key set not null;

alter table public.ready_saved_words
  drop constraint if exists ready_saved_words_student_id_passage_id_normalized_word_key;

alter table public.ready_saved_words
  add constraint ready_saved_words_student_passage_word_meaning_key
  unique (student_id, passage_id, normalized_word, meaning_key);

create table if not exists public.ready_word_states (
  student_id uuid not null references public.ready_students(id) on delete restrict,
  passage_id uuid not null references public.ready_passages(id) on delete restrict,
  normalized_word text not null,
  known boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, passage_id, normalized_word)
);

create index if not exists ready_word_states_student_passage_idx
  on public.ready_word_states(student_id, passage_id);

alter table public.ready_word_states enable row level security;
revoke all on public.ready_word_states from public, anon, authenticated;
grant all on public.ready_word_states to service_role;

create or replace function public.ready_set_word_known(
  p_student_id uuid,
  p_passage_id uuid,
  p_normalized_word text,
  p_known boolean
) returns void language plpgsql security definer set search_path=public as $$
begin
  if p_known then
    insert into ready_word_states(student_id, passage_id, normalized_word, known, created_at, updated_at)
    values (p_student_id, p_passage_id, p_normalized_word, true, now(), now())
    on conflict (student_id, passage_id, normalized_word)
    do update set known=true, updated_at=now();

    -- Breeze's "아는 단어 빼기" removes it from the active wordbook. READY
    -- does the equivalent atomically, preserving only the reversible known flag.
    delete from ready_saved_words
    where student_id=p_student_id and passage_id=p_passage_id and normalized_word=p_normalized_word;
  else
    delete from ready_word_states
    where student_id=p_student_id and passage_id=p_passage_id and normalized_word=p_normalized_word;
  end if;
end $$;

revoke all on function public.ready_set_word_known(uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.ready_set_word_known(uuid,uuid,text,boolean) to service_role;

-- Keep the existing cascade deletes complete when an administrator removes a
-- student or a passage. These replacements deliberately preserve all prior work.
create or replace function public.ready_delete_student_cascade(p_student_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from ready_students where id=p_student_id) then raise exception '학생을 찾지 못했습니다.'; end if;
  perform set_config('ready.allow_cascade_delete','on',true);
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
