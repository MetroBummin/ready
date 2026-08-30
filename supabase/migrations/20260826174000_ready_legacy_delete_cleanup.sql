-- Keep the active Passage deletion path compatible with production rows that
-- still have links in the retired StudySet / Publication schema. Clean READY
-- databases do not create those legacy tables, so the cleanup is conditional.

create or replace function public.ready_delete_passage_cascade(p_passage_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_question_ids uuid[];
begin
  if not exists (select 1 from public.ready_passages where id = p_passage_id) then
    raise exception '지문을 찾지 못했습니다.';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_question_ids
  from public.ready_questions
  where passage_id = p_passage_id;

  perform set_config('ready.allow_cascade_delete', 'on', true);
  delete from public.ready_attempts where question_id = any(v_question_ids);
  delete from public.ready_saved_words where passage_id = p_passage_id;
  delete from public.ready_saved_sentences where passage_id = p_passage_id;
  delete from public.ready_word_lookup_events where passage_id = p_passage_id;
  delete from public.ready_sentence_translation_view_events where passage_id = p_passage_id;
  delete from public.ready_exam_passages where passage_id = p_passage_id;

  if to_regclass('public.ready_publication_questions') is not null then
    execute 'delete from public.ready_publication_questions where question_id = any($1)'
      using v_question_ids;
  end if;

  delete from public.ready_questions where passage_id = p_passage_id;
  delete from public.ready_passages where id = p_passage_id;
end;
$$;

revoke all on function public.ready_delete_passage_cascade(uuid) from public, anon, authenticated;
grant execute on function public.ready_delete_passage_cascade(uuid) to service_role;
