-- READY Reader Intelligence. Passage import stays independent; bake output is applied atomically.
alter table public.ready_passages
  add column if not exists bake_status text not null default 'unbaked' check (bake_status in ('unbaked','processing','ready','failed')),
  add column if not exists bake_generation integer not null default 0,
  add column if not exists baked_at timestamptz,
  add column if not exists bake_error text;

create table if not exists public.ready_sentence_bakes (
  sentence_id uuid primary key references public.ready_passage_sentences(id) on delete cascade,
  passage_id uuid not null references public.ready_passages(id) on delete cascade,
  structure_summary text not null default '',
  grammar_points jsonb not null default '[]'::jsonb check (jsonb_typeof(grammar_points)='array'),
  key_expressions jsonb not null default '[]'::jsonb check (jsonb_typeof(key_expressions)='array'),
  difficulty text,
  generation integer not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.ready_sentence_tokens (
  id uuid primary key default gen_random_uuid(),
  sentence_id uuid not null references public.ready_passage_sentences(id) on delete cascade,
  passage_id uuid not null references public.ready_passages(id) on delete cascade,
  token_index integer not null check (token_index >= 0), surface text not null, normalized text not null, lemma text not null,
  start_offset integer not null check (start_offset >= 0), end_offset integer not null check (end_offset > start_offset),
  unique(sentence_id, token_index)
);
create table if not exists public.ready_lexical_concepts (
  id uuid primary key default gen_random_uuid(),
  concept_key text not null unique,
  kind text not null check (kind in ('word','phrase')),
  canonical_form text not null, lemma text, sense_key text not null, part_of_speech text,
  context_meaning text not null, alternative_senses jsonb not null default '[]'::jsonb check (jsonb_typeof(alternative_senses)='array'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.ready_lexical_occurrences (
  id uuid primary key default gen_random_uuid(),
  passage_id uuid not null references public.ready_passages(id) on delete cascade,
  sentence_id uuid not null references public.ready_passage_sentences(id) on delete cascade,
  concept_id uuid not null references public.ready_lexical_concepts(id) on delete restrict,
  occurrence_key text not null,
  surface_text text not null,
  token_ids uuid[] not null check (cardinality(token_ids)>0),
  specificity integer not null check (specificity>0),
  unique(sentence_id, occurrence_key)
);
create table if not exists public.ready_saved_lexical_items (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references public.ready_students(id) on delete restrict,
  concept_id uuid not null references public.ready_lexical_concepts(id) on delete restrict,
  meaning_snapshot text not null, created_at timestamptz not null default now(), unique(student_id, concept_id)
);
create table if not exists public.ready_saved_lexical_sources (
  saved_item_id uuid not null references public.ready_saved_lexical_items(id) on delete cascade,
  occurrence_id uuid not null references public.ready_lexical_occurrences(id) on delete cascade,
  passage_id uuid not null references public.ready_passages(id) on delete cascade,
  sentence_id uuid not null references public.ready_passage_sentences(id) on delete cascade,
  surface_text text not null, created_at timestamptz not null default now(), primary key(saved_item_id, occurrence_id)
);
alter table public.ready_word_lookup_events add column if not exists concept_id uuid references public.ready_lexical_concepts(id) on delete set null;
alter table public.ready_word_lookup_events add column if not exists occurrence_id uuid references public.ready_lexical_occurrences(id) on delete set null;
alter table public.ready_saved_sentences add column if not exists analysis_snapshot jsonb not null default '{}'::jsonb;

create index if not exists ready_tokens_passage_idx on public.ready_sentence_tokens(passage_id,sentence_id,token_index);
create index if not exists ready_occurrences_passage_idx on public.ready_lexical_occurrences(passage_id,sentence_id);
create index if not exists ready_saved_lexical_student_idx on public.ready_saved_lexical_items(student_id,created_at desc);

create or replace function public.ready_apply_passage_bake(p_passage_id uuid,p_generation integer,p_bake jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare s jsonb; t jsonb; c jsonb; v_concept_id uuid; v_token_ids uuid[];
begin
  if jsonb_typeof(p_bake->'sentences') <> 'array' then raise exception 'Bake sentences array is required.'; end if;
  create temporary table if not exists ready_bake_saved_sources(saved_item_id uuid,concept_key text,sentence_id uuid,occurrence_key text,surface_text text) on commit drop;
  truncate ready_bake_saved_sources;
  insert into ready_bake_saved_sources
  select src.saved_item_id,concept.concept_key,src.sentence_id,occurrence.occurrence_key,src.surface_text
  from ready_saved_lexical_sources src join ready_saved_lexical_items item on item.id=src.saved_item_id join ready_lexical_concepts concept on concept.id=item.concept_id join ready_lexical_occurrences occurrence on occurrence.id=src.occurrence_id
  where src.passage_id=p_passage_id;
  delete from ready_lexical_occurrences where passage_id=p_passage_id;
  delete from ready_sentence_tokens where passage_id=p_passage_id;
  delete from ready_sentence_bakes where passage_id=p_passage_id;
  for s in select * from jsonb_array_elements(p_bake->'sentences') loop
    if not exists(select 1 from ready_passage_sentences where id=(s->>'sentenceId')::uuid and passage_id=p_passage_id) then raise exception 'Bake contains a foreign sentence.'; end if;
    insert into ready_sentence_bakes(sentence_id,passage_id,structure_summary,grammar_points,key_expressions,difficulty,generation)
    values((s->>'sentenceId')::uuid,p_passage_id,coalesce(s->>'structureSummary',''),coalesce(s->'grammarPoints','[]'),coalesce(s->'keyExpressions','[]'),s->>'difficulty',p_generation);
    for t in select * from jsonb_array_elements(s->'tokens') loop
      insert into ready_sentence_tokens(sentence_id,passage_id,token_index,surface,normalized,lemma,start_offset,end_offset)
      values((s->>'sentenceId')::uuid,p_passage_id,(t->>'tokenIndex')::integer,t->>'surface',t->>'normalized',t->>'lemma',(t->>'startOffset')::integer,(t->>'endOffset')::integer);
    end loop;
    for c in select * from jsonb_array_elements(coalesce(s->'concepts','[]')) loop
      insert into ready_lexical_concepts(concept_key,kind,canonical_form,lemma,sense_key,part_of_speech,context_meaning,alternative_senses)
      values(c->>'conceptKey',c->>'kind',c->>'canonicalForm',nullif(c->>'lemma',''),c->>'senseKey',nullif(c->>'partOfSpeech',''),c->>'contextMeaning',coalesce(c->'alternativeSenses','[]'))
      on conflict(concept_key) do update set context_meaning=excluded.context_meaning,alternative_senses=excluded.alternative_senses,updated_at=now()
      returning id into v_concept_id;
      select array_agg(tok.id order by ord.n) into v_token_ids
      from jsonb_array_elements_text(c->'tokenIndexes') with ordinality ord(value,n)
      join ready_sentence_tokens tok on tok.sentence_id=(s->>'sentenceId')::uuid and tok.token_index=ord.value::integer;
      if cardinality(v_token_ids) <> jsonb_array_length(c->'tokenIndexes') then raise exception 'Bake token mapping is invalid.'; end if;
      insert into ready_lexical_occurrences(passage_id,sentence_id,concept_id,occurrence_key,surface_text,token_ids,specificity)
      values(p_passage_id,(s->>'sentenceId')::uuid,v_concept_id,c->>'occurrenceKey',c->>'surfaceText',v_token_ids,cardinality(v_token_ids));
    end loop;
  end loop;
  insert into ready_saved_lexical_sources(saved_item_id,occurrence_id,passage_id,sentence_id,surface_text)
  select saved.saved_item_id,occurrence.id,p_passage_id,occurrence.sentence_id,saved.surface_text
  from ready_bake_saved_sources saved join ready_lexical_occurrences occurrence on occurrence.sentence_id=saved.sentence_id and occurrence.occurrence_key=saved.occurrence_key
  on conflict do nothing;
  update ready_passages set bake_status='ready',bake_generation=p_generation,baked_at=now(),bake_error=null where id=p_passage_id;
end $$;

-- Atomic deletes now own Reader Intelligence and remove concept rows only when no source remains.
create or replace function public.ready_delete_student_cascade(p_student_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from ready_students where id=p_student_id) then raise exception '학생을 찾지 못했습니다.'; end if;
  perform set_config('ready.allow_cascade_delete','on',true);
  delete from ready_attempts where student_id=p_student_id; delete from ready_saved_lexical_items where student_id=p_student_id;
  delete from ready_saved_words where student_id=p_student_id; delete from ready_saved_sentences where student_id=p_student_id;
  delete from ready_word_lookup_events where student_id=p_student_id; delete from ready_sentence_translation_view_events where student_id=p_student_id;
  delete from ready_sessions where student_id=p_student_id; delete from ready_login_attempts where identifier='student:'||p_student_id::text; delete from ready_students where id=p_student_id;
end $$;
create or replace function public.ready_delete_passage_cascade(p_passage_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare v_question_ids uuid[]; begin
  if not exists(select 1 from ready_passages where id=p_passage_id) then raise exception '지문을 찾지 못했습니다.'; end if;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_question_ids from ready_questions where passage_id=p_passage_id;
  perform set_config('ready.allow_cascade_delete','on',true);
  delete from ready_attempts where question_id=any(v_question_ids); delete from ready_saved_words where passage_id=p_passage_id;
  delete from ready_saved_sentences where passage_id=p_passage_id; delete from ready_word_lookup_events where passage_id=p_passage_id;
  delete from ready_sentence_translation_view_events where passage_id=p_passage_id; delete from ready_exam_passages where passage_id=p_passage_id;
  if to_regclass('public.ready_publication_questions') is not null then execute 'delete from public.ready_publication_questions where question_id=any($1)' using v_question_ids; end if;
  delete from ready_questions where passage_id=p_passage_id; delete from ready_passages where id=p_passage_id;
  delete from ready_saved_lexical_items item where not exists(select 1 from ready_saved_lexical_sources src where src.saved_item_id=item.id);
  delete from ready_lexical_concepts concept where not exists(select 1 from ready_lexical_occurrences occurrence where occurrence.concept_id=concept.id) and not exists(select 1 from ready_saved_lexical_items item where item.concept_id=concept.id);
end $$;

alter table public.ready_sentence_bakes enable row level security; alter table public.ready_sentence_tokens enable row level security;
alter table public.ready_lexical_concepts enable row level security; alter table public.ready_lexical_occurrences enable row level security;
alter table public.ready_saved_lexical_items enable row level security; alter table public.ready_saved_lexical_sources enable row level security;
revoke all on public.ready_sentence_bakes,public.ready_sentence_tokens,public.ready_lexical_concepts,public.ready_lexical_occurrences,public.ready_saved_lexical_items,public.ready_saved_lexical_sources from anon,authenticated;
grant all on public.ready_sentence_bakes,public.ready_sentence_tokens,public.ready_lexical_concepts,public.ready_lexical_occurrences,public.ready_saved_lexical_items,public.ready_saved_lexical_sources to service_role;
revoke all on function public.ready_apply_passage_bake(uuid,integer,jsonb) from public,anon,authenticated; grant execute on function public.ready_apply_passage_bake(uuid,integer,jsonb) to service_role;
