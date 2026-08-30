-- READY is deterministic at rest: teacher sentences/translations plus on-demand
-- dictionary lookup. Preserve every saved lexical item before removing bake data.
alter table public.ready_word_cache add column if not exists meanings jsonb not null default '[]'::jsonb;
update public.ready_word_cache set meanings=jsonb_build_array(meaning) where meanings='[]'::jsonb and nullif(trim(meaning),'') is not null;

insert into public.ready_saved_words(student_id,passage_id,sentence_id,word,normalized_word,meaning_snapshot,created_at)
select distinct on (item.student_id,source.passage_id,coalesce(nullif(concept.lemma,''),concept.canonical_form))
  item.student_id,
  source.passage_id,
  source.sentence_id,
  left(coalesce(nullif(source.surface_text,''),concept.canonical_form),100),
  left(lower(coalesce(nullif(concept.lemma,''),concept.canonical_form)),100),
  item.meaning_snapshot,
  item.created_at
from public.ready_saved_lexical_items item
join public.ready_lexical_concepts concept on concept.id=item.concept_id
join public.ready_saved_lexical_sources source on source.saved_item_id=item.id
order by item.student_id,source.passage_id,coalesce(nullif(concept.lemma,''),concept.canonical_form),source.created_at
on conflict(student_id,passage_id,normalized_word) do update
set meaning_snapshot=excluded.meaning_snapshot;

do $$
begin
  if exists (
    select 1 from public.ready_saved_lexical_items item
    where not exists (
      select 1
      from public.ready_saved_lexical_sources source
      join public.ready_lexical_concepts concept on concept.id=item.concept_id
      join public.ready_saved_words saved
        on saved.student_id=item.student_id
       and saved.passage_id=source.passage_id
       and saved.normalized_word=left(lower(coalesce(nullif(concept.lemma,''),concept.canonical_form)),100)
      where source.saved_item_id=item.id
    )
  ) then
    raise exception 'Saved lexical migration is incomplete; bake tables were not removed.';
  end if;
end $$;

drop function if exists public.ready_apply_passage_bake(uuid,integer,jsonb);
alter table public.ready_word_lookup_events drop column if exists concept_id, drop column if exists occurrence_id;
alter table public.ready_saved_sentences drop column if exists analysis_snapshot;
alter table public.ready_passages drop column if exists bake_status, drop column if exists bake_generation, drop column if exists baked_at, drop column if exists bake_error;
alter table public.ready_word_cache drop column if exists meaning;

drop table if exists public.ready_saved_lexical_sources;
drop table if exists public.ready_saved_lexical_items;
drop table if exists public.ready_lexical_concept_aliases;
drop table if exists public.ready_lexical_occurrences;
drop table if exists public.ready_lexical_concepts;
drop table if exists public.ready_sentence_tokens;
drop table if exists public.ready_sentence_bakes;

create or replace function public.ready_delete_student_cascade(p_student_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from ready_students where id=p_student_id) then raise exception '학생을 찾지 못했습니다.'; end if;
  perform set_config('ready.allow_cascade_delete','on',true);
  delete from ready_attempts where student_id=p_student_id;
  delete from ready_saved_words where student_id=p_student_id;
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
