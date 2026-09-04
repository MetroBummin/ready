-- Rubric v1. This is intentionally null-only so reviewed difficulty values win.
update public.ready_questions
set difficulty = case
  when type = 'written_response' and (
    jsonb_array_length(coalesce(payload->'response_slots', '[]'::jsonb)) >= 3
    or exists (
      select 1
      from jsonb_array_elements(coalesce(payload->'response_slots', '[]'::jsonb)) as slot
      where coalesce(nullif(slot->>'word_count', ''), '0')::integer >= 12
    )
  ) then 3
  when type = 'written_response' then 2
  when coalesce(payload->'spec'->>'taxonomy', payload->>'taxonomy', '') in (
    'paragraph_order', 'sentence_insertion', 'grammar_multi_error',
    'implication', 'summary_two_blank'
  ) then 3
  when coalesce(payload->'spec'->>'taxonomy', payload->>'taxonomy', '') in (
    'content_true', 'content_false', 'unanswerable', 'main_idea', 'topic', 'title'
  ) then 1
  else 2
end
where status = 'available'
  and difficulty is null;
