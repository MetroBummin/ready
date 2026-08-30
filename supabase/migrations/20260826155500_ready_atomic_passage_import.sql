-- READY single Passage import: one pasted row is one immutable sentence boundary.
-- Passage and all sentence/translation rows are committed in one transaction.

create or replace function public.ready_create_passage_with_sentences(
  p_title text,
  p_source_type text,
  p_grade text,
  p_source_year integer,
  p_source_month integer,
  p_source_label text,
  p_rows jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_passage_id uuid;
  v_row_count integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception '문장 rows는 배열이어야 합니다.';
  end if;

  v_row_count := jsonb_array_length(p_rows);
  if v_row_count < 1 or v_row_count > 80 then
    raise exception '한 지문은 1~80행이어야 합니다.';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception '지문 제목 값이 올바르지 않습니다.';
  end if;
  if p_source_type is null or p_source_type not in ('TEXTBOOK', 'MOCK_EXAM') then
    raise exception '지문 종류 값이 올바르지 않습니다.';
  end if;
  if char_length(trim(coalesce(p_grade, ''))) not between 1 and 40 then
    raise exception '학년 값이 올바르지 않습니다.';
  end if;
  if p_source_type = 'MOCK_EXAM' and (p_source_year is null or p_source_month is null or p_source_month not between 1 and 12) then
    raise exception '모의고사는 연도와 월이 필요합니다.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as row_value
    where jsonb_typeof(row_value) <> 'object'
      or char_length(trim(coalesce(row_value ->> 'text', ''))) not between 1 and 5000
      or char_length(trim(coalesce(row_value ->> 'translation', ''))) not between 1 and 5000
  ) then
    raise exception '모든 행에 영어 문장과 한국어 해석이 필요합니다.';
  end if;

  insert into public.ready_passages(
    title, source_text, display_order, source_type, grade, source_year, source_month, source_label,
    study_status, translation_source, processing_error
  )
  select
    trim(p_title),
    (select string_agg(trim(row_value ->> 'text'), ' ' order by ordinal)
       from jsonb_array_elements(p_rows) with ordinality as item(row_value, ordinal)),
    coalesce((select max(display_order) + 1 from public.ready_passages), 0),
    p_source_type, trim(p_grade), p_source_year, p_source_month,
    trim(coalesce(p_source_label, '')), 'ready', 'teacher', ''
  returning id into v_passage_id;

  insert into public.ready_passage_sentences(passage_id, sentence_index, text, translation)
  select v_passage_id, (ordinal - 1)::integer,
         trim(row_value ->> 'text'), trim(row_value ->> 'translation')
  from jsonb_array_elements(p_rows) with ordinality as item(row_value, ordinal)
  order by ordinal;

  return v_passage_id;
end;
$$;

revoke all on function public.ready_create_passage_with_sentences(text, text, text, integer, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.ready_create_passage_with_sentences(text, text, text, integer, integer, text, jsonb) to service_role;
