-- Question-first runtime: two deterministic response contracts, atomic private
-- bundle import, and lookup indexes for passage solving and last-attempt review.

drop index if exists public.ready_questions_available_passage_idx;
create index if not exists ready_questions_available_passage_idx
  on public.ready_questions(passage_id, created_at)
  where status = 'available' and type in ('multiple_choice', 'written_response');

create index if not exists ready_attempts_review_idx
  on public.ready_attempts(student_id, exam_id, question_id, created_at desc);

create or replace function public.ready_import_question_bundle(p_questions jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  source jsonb;
  v_passage_id uuid;
  question_type text;
  question_status text;
  existing_id uuid;
  imported integer := 0;
begin
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) < 1 then
    raise exception 'Question bundle must be a non-empty JSON array.';
  end if;
  if jsonb_array_length(p_questions) > 500 then
    raise exception 'Question bundle is limited to 500 rows.';
  end if;

  for item in select value from jsonb_array_elements(p_questions)
  loop
    v_passage_id := nullif(item->>'passage_id', '')::uuid;
    question_type := item->>'type';
    question_status := coalesce(nullif(item->>'status', ''), 'draft');
    source := item->'payload'->'source';

    if not exists(select 1 from ready_passages where id = v_passage_id) then
      raise exception 'Unknown canonical Passage: %', v_passage_id;
    end if;
    if coalesce(question_type, '') not in ('multiple_choice', 'written_response') then
      raise exception 'Unsupported Question type: %', question_type;
    end if;
    if question_status not in ('draft', 'available') then
      raise exception 'Invalid Question status: %', question_status;
    end if;
    if trim(coalesce(item->'payload'->>'prompt', '')) = '' then
      raise exception 'Question prompt is required.';
    end if;
    if trim(coalesce(source->>'exam', '')) = ''
       or coalesce(source->>'passage_no', '') !~ '^\d+$'
       or coalesce(source->>'source_question_no', '') !~ '^\d+$'
       or trim(coalesce(source->>'section', '')) = '' then
      raise exception 'Every Question needs source exam, passage_no, source_question_no, and section.';
    end if;
    if question_type = 'multiple_choice' and (
      jsonb_typeof(item->'payload'->'choices') <> 'array'
      or jsonb_array_length(item->'payload'->'choices') not between 2 and 8
      or jsonb_typeof(item->'payload'->'answer') <> 'array'
      or jsonb_array_length(item->'payload'->'answer') < 1
    ) then raise exception 'Multiple-choice payload is incomplete.'; end if;
    if question_type = 'written_response' and (
      jsonb_typeof(item->'payload'->'accepted_answers') <> 'array'
      or jsonb_array_length(item->'payload'->'accepted_answers') < 1
    ) then raise exception 'Written-response accepted_answers are required.'; end if;

    existing_id := null;
    select id into existing_id
    from ready_questions
    where ready_questions.passage_id = v_passage_id
      and payload->'source'->>'exam' = source->>'exam'
      and payload->'source'->>'passage_no' = source->>'passage_no'
      and payload->'source'->>'source_question_no' = source->>'source_question_no'
      and payload->'source'->>'section' = source->>'section'
    limit 1;

    if existing_id is null then
      insert into ready_questions(passage_id, type, difficulty, payload, status, generation)
      values(v_passage_id, question_type, nullif(item->>'difficulty', '')::smallint, item->'payload', question_status, coalesce(nullif(item->>'generation', '')::integer, 1));
    else
      update ready_questions
      set type = question_type,
          difficulty = nullif(item->>'difficulty', '')::smallint,
          payload = item->'payload',
          status = question_status,
          generation = coalesce(nullif(item->>'generation', '')::integer, generation),
          updated_at = now()
      where id = existing_id;
    end if;
    imported := imported + 1;
  end loop;
  return imported;
end;
$$;

revoke all on function public.ready_import_question_bundle(jsonb) from public, anon, authenticated;
grant execute on function public.ready_import_question_bundle(jsonb) to service_role;
