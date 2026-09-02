-- A saved word is the active lemma row. Its individual meanings live below it so
-- repeated senses are idempotent while a whole-lemma remove is one atomic delete.
create table if not exists public.ready_saved_word_senses (
  id uuid primary key default gen_random_uuid(),
  saved_word_id uuid not null references public.ready_saved_words(id) on delete cascade,
  meaning text not null check (char_length(trim(meaning)) between 1 and 60),
  meaning_key text not null,
  origin_event_id uuid references public.ready_word_lookup_events(id) on delete set null,
  origin_occurrence_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (saved_word_id, meaning_key)
);

insert into public.ready_saved_word_senses(saved_word_id,meaning,meaning_key,origin_occurrence_key)
select id,meaning_snapshot,coalesce(nullif(meaning_key,''),left(lower(regexp_replace(trim(meaning_snapshot),'\s+',' ','g')),500)),origin_occurrence_key
from public.ready_saved_words
where nullif(trim(meaning_snapshot),'') is not null
on conflict (saved_word_id,meaning_key) do nothing;

create index if not exists ready_saved_word_senses_saved_word_idx on public.ready_saved_word_senses(saved_word_id,created_at desc);
alter table public.ready_saved_word_senses enable row level security;
revoke all on public.ready_saved_word_senses from public, anon, authenticated;
grant all on public.ready_saved_word_senses to service_role;

-- Shared cache: no per-student sentence translation/structure duplicates.
create table if not exists public.ready_sentence_learning_cache (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('reader')),
  source_key text not null,
  passage_id uuid not null references public.ready_passages(id) on delete cascade,
  sentence_id uuid not null references public.ready_passage_sentences(id) on delete cascade,
  passage_revision timestamptz,
  sentence_hash text not null,
  prompt_version text not null,
  easy_translation text,
  structure_chunks jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_kind,source_key,passage_revision,sentence_hash,prompt_version)
);
create index if not exists ready_sentence_learning_cache_sentence_idx on public.ready_sentence_learning_cache(sentence_id,prompt_version);
alter table public.ready_sentence_learning_cache enable row level security;
revoke all on public.ready_sentence_learning_cache from public, anon, authenticated;
grant all on public.ready_sentence_learning_cache to service_role;
