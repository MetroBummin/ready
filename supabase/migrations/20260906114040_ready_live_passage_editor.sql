-- Canonical Passage rows remain editable after publication. Removed rows are
-- retained as inactive records so historical Reader/lookup data keeps its FK.
alter table public.ready_passage_sentences
  add column if not exists block_type text not null default 'SENTENCE'
    check (block_type in ('TITLE','SUBTITLE','SENTENCE')),
  add column if not exists paragraph_index integer not null default 0
    check (paragraph_index >= 0),
  add column if not exists active boolean not null default true;

alter table public.ready_passages
  add column if not exists canonical_revision integer not null default 1
    check (canonical_revision >= 1),
  add column if not exists deterministic_catalog_revision integer,
  add column if not exists deterministic_status text not null default 'missing'
    check (deterministic_status in ('missing','pending','current','failed')),
  add column if not exists deterministic_error text not null default '',
  add column if not exists ai_workbook_revision integer,
  add column if not exists ai_regeneration_required boolean not null default false;

alter table public.ready_workbook_catalogs
  add column if not exists canonical_revision integer;

alter table public.ready_workbook_attempts
  add column if not exists passage_revision integer,
  add column if not exists catalog_revision integer;

update public.ready_workbook_catalogs catalog
set canonical_revision=coalesce(catalog.canonical_revision,passage.canonical_revision)
from public.ready_passages passage
where catalog.passage_id=passage.id and catalog.canonical_revision is null;

update public.ready_passages passage
set deterministic_catalog_revision=coalesce(passage.deterministic_catalog_revision,passage.canonical_revision),
    deterministic_status='current'
where exists(select 1 from public.ready_workbook_catalogs catalog where catalog.passage_id=passage.id);

create index if not exists ready_passage_sentences_active_idx
  on public.ready_passage_sentences(passage_id, active, sentence_index);

create or replace function public.ready_save_canonical_passage(
  p_passage_id uuid,
  p_title text,
  p_source_type text,
  p_grade text,
  p_source_year integer,
  p_source_month integer,
  p_source_label text,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision integer;
  v_row jsonb;
  v_id uuid;
  v_index integer := 0;
  v_active_ids uuid[] := array[]::uuid[];
begin
  perform 1 from public.ready_passages where id = p_passage_id for update;
  if not found then raise exception 'Passage를 찾지 못했습니다.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 160 then
    raise exception 'Passage rows는 1~160행이어야 합니다.';
  end if;
  if char_length(trim(coalesce(p_title,''))) not between 1 and 120 then raise exception '지문 제목 값이 올바르지 않습니다.'; end if;
  if p_source_type not in ('TEXTBOOK','MOCK_EXAM') then raise exception '지문 종류 값이 올바르지 않습니다.'; end if;
  if char_length(trim(coalesce(p_grade,''))) not between 1 and 40 then raise exception '학년 값이 올바르지 않습니다.'; end if;
  if p_source_type = 'MOCK_EXAM' and (p_source_year is null or p_source_month not between 1 and 12) then raise exception '모의고사는 연도와 월이 필요합니다.'; end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if coalesce(v_row->>'blockType','') not in ('TITLE','SUBTITLE','SENTENCE') then raise exception '%번 행의 블록 타입이 올바르지 않습니다.', v_index + 1; end if;
    if char_length(trim(coalesce(v_row->>'text',''))) not between 1 and 5000 then raise exception '%번 행의 English가 비어 있거나 너무 깁니다.', v_index + 1; end if;
    if v_row->>'blockType' = 'SENTENCE' and char_length(trim(coalesce(v_row->>'translation',''))) not between 1 and 5000 then raise exception '%번 문장의 Korean이 비어 있거나 너무 깁니다.', v_index + 1; end if;
    if coalesce((v_row->>'paragraphIndex')::integer,0) < 0 then raise exception '%번 행의 문단 값이 올바르지 않습니다.', v_index + 1; end if;
    if nullif(v_row->>'id','') is not null then
      v_id := (v_row->>'id')::uuid;
      if not exists(select 1 from public.ready_passage_sentences where id=v_id and passage_id=p_passage_id) then raise exception '다른 Passage의 행은 저장할 수 없습니다.'; end if;
    end if;
    v_index := v_index + 1;
  end loop;

  -- Free the unique (passage_id, sentence_index) range without deleting rows.
  update public.ready_passage_sentences
  set sentence_index = 1000000 + moved.moved_index
  from (
    select id, row_number() over(order by sentence_index,id)::integer as moved_index
    from public.ready_passage_sentences where passage_id=p_passage_id
  ) moved
  where ready_passage_sentences.id=moved.id;

  v_index := 0;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_id := nullif(v_row->>'id','')::uuid;
    if v_id is null then
      insert into public.ready_passage_sentences(passage_id,sentence_index,text,translation,block_type,paragraph_index,active)
      values(p_passage_id,v_index,trim(v_row->>'text'),trim(coalesce(v_row->>'translation','')),v_row->>'blockType',coalesce((v_row->>'paragraphIndex')::integer,0),true)
      returning id into v_id;
    else
      update public.ready_passage_sentences set sentence_index=v_index,text=trim(v_row->>'text'),translation=trim(coalesce(v_row->>'translation','')),block_type=v_row->>'blockType',paragraph_index=coalesce((v_row->>'paragraphIndex')::integer,0),active=true where id=v_id;
    end if;
    v_active_ids := array_append(v_active_ids,v_id);
    v_index := v_index + 1;
  end loop;
  update public.ready_passage_sentences set active=false where passage_id=p_passage_id and not(id=any(v_active_ids));

  update public.ready_passages
  set title=trim(p_title), source_type=p_source_type, grade=trim(p_grade), source_year=p_source_year,
      source_month=p_source_month, source_label=trim(coalesce(p_source_label,'')),
      source_text=(select string_agg(text,' ' order by sentence_index) from public.ready_passage_sentences where passage_id=p_passage_id and active and block_type='SENTENCE'),
      canonical_revision=canonical_revision+1, deterministic_status='pending', deterministic_error='',
      ai_regeneration_required=true
  where id=p_passage_id
  returning canonical_revision into v_revision;
  return v_revision;
end;
$$;

create or replace function public.ready_publish_deterministic_catalog(
  p_passage_id uuid,
  p_expected_revision integer,
  p_workbook_key text,
  p_catalog jsonb,
  p_provenance jsonb,
  p_metrics jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.ready_passages where id=p_passage_id and canonical_revision=p_expected_revision for update;
  if not found then raise exception 'Passage가 생성 중 다시 수정되었습니다.'; end if;
  insert into public.ready_workbook_catalogs(passage_id,workbook_key,catalog,provenance,metrics,canonical_revision,updated_at)
  values(p_passage_id,p_workbook_key,p_catalog,p_provenance,p_metrics,p_expected_revision,now())
  on conflict(passage_id) do update set workbook_key=excluded.workbook_key,catalog=excluded.catalog,provenance=excluded.provenance,metrics=excluded.metrics,canonical_revision=excluded.canonical_revision,updated_at=now();
  update public.ready_passages set deterministic_catalog_revision=p_expected_revision,deterministic_status='current',deterministic_error='' where id=p_passage_id;
end;
$$;

revoke all on function public.ready_save_canonical_passage(uuid,text,text,text,integer,integer,text,jsonb) from public,anon,authenticated;
revoke all on function public.ready_publish_deterministic_catalog(uuid,integer,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ready_save_canonical_passage(uuid,text,text,text,integer,integer,text,jsonb) to service_role;
grant execute on function public.ready_publish_deterministic_catalog(uuid,integer,text,jsonb,jsonb,jsonb) to service_role;

create or replace function public.ready_create_passage_with_sentences(
  p_title text,p_source_type text,p_grade text,p_source_year integer,p_source_month integer,p_source_label text,p_rows jsonb
)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_passage_id uuid; v_count integer;
begin
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Passage rows는 배열이어야 합니다.'; end if;
  v_count=jsonb_array_length(p_rows); if v_count not between 1 and 160 then raise exception '한 지문은 1~160행이어야 합니다.'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) row_value where
    coalesce(row_value->>'blockType','SENTENCE') not in ('TITLE','SUBTITLE','SENTENCE') or
    char_length(trim(coalesce(row_value->>'text',''))) not between 1 and 5000 or
    (coalesce(row_value->>'blockType','SENTENCE')='SENTENCE' and char_length(trim(coalesce(row_value->>'translation',''))) not between 1 and 5000)
  ) then raise exception '각 행의 타입, English, Korean을 확인해 주세요.'; end if;
  insert into public.ready_passages(title,source_text,display_order,source_type,grade,source_year,source_month,source_label,study_status,translation_source,processing_error,deterministic_status)
  select trim(p_title),(select string_agg(trim(row_value->>'text'),' ' order by ordinal) from jsonb_array_elements(p_rows) with ordinality item(row_value,ordinal) where coalesce(row_value->>'blockType','SENTENCE')='SENTENCE'),coalesce((select max(display_order)+1 from public.ready_passages),0),p_source_type,trim(p_grade),p_source_year,p_source_month,trim(coalesce(p_source_label,'')),'ready','teacher','','pending'
  returning id into v_passage_id;
  insert into public.ready_passage_sentences(passage_id,sentence_index,text,translation,block_type,paragraph_index,active)
  select v_passage_id,(ordinal-1)::integer,trim(row_value->>'text'),trim(coalesce(row_value->>'translation','')),coalesce(row_value->>'blockType','SENTENCE'),coalesce((row_value->>'paragraphIndex')::integer,0),true
  from jsonb_array_elements(p_rows) with ordinality item(row_value,ordinal) order by ordinal;
  return v_passage_id;
end;$$;

revoke all on function public.ready_create_passage_with_sentences(text,text,text,integer,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.ready_create_passage_with_sentences(text,text,text,integer,integer,text,jsonb) to service_role;
