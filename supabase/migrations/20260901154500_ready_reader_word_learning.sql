-- Reader Word Learning keeps one active saved lemma per student and exam while
-- retaining lookup events as the append-only context history.
alter table public.ready_saved_words
  add column if not exists exam_id uuid references public.ready_exams(id) on delete cascade,
  add column if not exists core_meanings jsonb not null default '[]'::jsonb,
  add column if not exists memory_level smallint not null default 1,
  add column if not exists origin_occurrence_key text,
  add column if not exists updated_at timestamptz not null default now();

update public.ready_saved_words
set core_meanings = jsonb_build_array(meaning_snapshot)
where core_meanings = '[]'::jsonb and trim(meaning_snapshot) <> '';

alter table public.ready_saved_words
  drop constraint if exists ready_saved_words_memory_level_valid,
  add constraint ready_saved_words_memory_level_valid check (memory_level between 1 and 3),
  drop constraint if exists ready_saved_words_core_meanings_array,
  add constraint ready_saved_words_core_meanings_array check (jsonb_typeof(core_meanings) = 'array');

create unique index if not exists ready_saved_words_student_exam_lemma_idx
  on public.ready_saved_words(student_id, exam_id, normalized_word)
  where exam_id is not null;

create index if not exists ready_saved_words_exam_student_idx
  on public.ready_saved_words(exam_id, student_id, created_at desc)
  where exam_id is not null;

alter table public.ready_word_lookup_events
  add column if not exists occurrence_key text,
  add column if not exists english_sentence_snapshot text,
  add column if not exists publisher_translation_snapshot text,
  add column if not exists core_meaning_snapshot text,
  add column if not exists lookup_reason text not null default 'initial',
  add column if not exists resolved boolean not null default false;

alter table public.ready_word_lookup_events
  drop constraint if exists ready_word_lookup_reason_valid,
  add constraint ready_word_lookup_reason_valid check (lookup_reason in ('initial','retry'));

create index if not exists ready_word_lookup_occurrence_idx
  on public.ready_word_lookup_events(student_id, exam_id, normalized_word, occurrence_key, created_at desc)
  where resolved = true and occurrence_key is not null;
