-- Publisher PDF explanations are immutable Question assets.  Update only the
-- explanation field so a re-sync cannot alter grading or worksheet context.

create or replace function public.ready_import_question_explanations(p_explanations jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  matched integer;
  imported integer := 0;
begin
  if jsonb_typeof(p_explanations) <> 'array'
     or jsonb_array_length(p_explanations) < 1
     or jsonb_array_length(p_explanations) > 500 then
    raise exception 'Explanation bundle must contain 1 to 500 rows.';
  end if;

  for item in select value from jsonb_array_elements(p_explanations)
  loop
    if trim(coalesce(item->>'exam', '')) = ''
       or trim(coalesce(item->>'section', '')) = ''
       or coalesce(item->>'question_no', '') !~ '^\d+$'
       or trim(coalesce(item->>'explanation', '')) = '' then
      raise exception 'Explanation identity or text is incomplete.';
    end if;

    update ready_questions
       set payload = jsonb_set(payload, '{explanation}', to_jsonb(item->>'explanation'), true),
           updated_at = now()
     where payload->'source'->>'exam' = item->>'exam'
       and payload->'source'->>'section' = item->>'section'
       and payload->'source'->>'source_question_no' = item->>'question_no';
    get diagnostics matched = row_count;
    if matched <> 1 then
      raise exception 'Explanation identity matched % Questions: % / % / %', matched, item->>'exam', item->>'section', item->>'question_no';
    end if;
    imported := imported + 1;
  end loop;
  return imported;
end;
$$;

revoke all on function public.ready_import_question_explanations(jsonb) from public, anon, authenticated;
grant execute on function public.ready_import_question_explanations(jsonb) to service_role;
