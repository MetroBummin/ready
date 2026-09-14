create unique index if not exists ready_workbook_factory_jobs_source_identity_ready_idx
  on public.ready_workbook_factory_jobs ((source_metadata->>'sourceIdentity'))
  where status='ready' and nullif(source_metadata->>'sourceIdentity','') is not null;

alter table public.ready_passages drop constraint if exists ready_passages_translation_source_check;
alter table public.ready_passages add constraint ready_passages_translation_source_check
  check (translation_source in ('none','teacher','ai','publisher'));

create or replace function public.ready_apply_publisher_workbook_import(
  p_job_id uuid,
  p_passage_id uuid,
  p_create_new boolean,
  p_expected_revision integer,
  p_expected_version integer,
  p_title text,
  p_rows jsonb,
  p_state jsonb,
  p_catalog jsonb
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_job public.ready_workbook_factory_jobs;
  v_passage public.ready_passages;
  v_meta jsonb;
  v_row jsonb;
  v_index integer := 0;
begin
  select * into v_job from public.ready_workbook_factory_jobs where id=p_job_id for update;
  if not found or v_job.status<>'review_required' then raise exception 'Publisher import 작업을 찾지 못했습니다.'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 160 then raise exception 'Passage rows를 확인해 주세요.'; end if;
  v_meta:=v_job.source_metadata;

  if p_create_new then
    if exists(select 1 from public.ready_passages where id=p_passage_id) then raise exception '같은 Passage ID가 이미 존재합니다.'; end if;
    if exists(select 1 from jsonb_array_elements(p_rows) item where
      nullif(item->>'id','') is null or
      coalesce(item->>'blockType','SENTENCE') not in ('TITLE','SUBTITLE','SENTENCE') or
      char_length(trim(coalesce(item->>'text',''))) not between 1 and 5000 or
      (coalesce(item->>'blockType','SENTENCE')='SENTENCE' and char_length(trim(coalesce(item->>'translation',''))) not between 1 and 5000)
    ) then raise exception '새 Passage 문장 ID와 본문·해석을 확인해 주세요.'; end if;
    insert into public.ready_passages(id,title,source_text,display_order,source_type,grade,source_year,source_month,source_label,study_status,translation_source,processing_error,deterministic_status,studio_state)
    select p_passage_id,trim(p_title),(select string_agg(trim(item->>'text'),' ' order by ordinal) from jsonb_array_elements(p_rows) with ordinality source(item,ordinal) where coalesce(item->>'blockType','SENTENCE')='SENTENCE'),coalesce((select max(display_order)+1 from public.ready_passages),0),coalesce(v_meta->>'sourceType','MOCK_EXAM'),trim(coalesce(v_meta->>'grade','')),nullif(v_meta->>'sourceYear','')::integer,nullif(v_meta->>'sourceMonth','')::integer,trim(coalesce(v_meta->>'sourceLabel','')),'ready','publisher','','pending','{}'::jsonb;
    insert into public.ready_passage_sentences(id,passage_id,sentence_index,text,translation,block_type,paragraph_index,active)
    select (item->>'id')::uuid,p_passage_id,(ordinal-1)::integer,trim(item->>'text'),trim(coalesce(item->>'translation','')),coalesce(item->>'blockType','SENTENCE'),coalesce((item->>'paragraphIndex')::integer,0),true
    from jsonb_array_elements(p_rows) with ordinality source(item,ordinal) order by ordinal;
  else
    if (select count(*) from public.ready_passage_sentences where passage_id=p_passage_id and active)<>jsonb_array_length(p_rows) then raise exception '기존 canonical 문장 수가 변경되었습니다.'; end if;
    for v_row in select value from jsonb_array_elements(p_rows) loop
      if not exists(select 1 from public.ready_passage_sentences sentence where sentence.id=(v_row->>'id')::uuid and sentence.passage_id=p_passage_id and sentence.active and sentence.sentence_index=v_index and sentence.text=v_row->>'text' and sentence.translation=v_row->>'translation') then raise exception '기존 canonical 문장이 변경되었습니다.'; end if;
      v_index:=v_index+1;
    end loop;
  end if;

  select * into v_passage from public.ready_passages where id=p_passage_id for update;
  if not found or v_passage.canonical_revision<>p_expected_revision then raise exception 'Passage가 변경되었습니다. 다시 실행해 주세요.'; end if;
  if coalesce((v_passage.studio_state->>'version')::integer,0)<>p_expected_version then raise exception 'Authoring이 변경되었습니다. 다시 실행해 주세요.'; end if;
  update public.ready_passages set studio_state=p_state||jsonb_build_object('version',p_expected_version+1),ai_regeneration_required=false where id=p_passage_id;
  perform public.ready_publish_deterministic_catalog(p_passage_id,p_expected_revision,p_catalog->>'workbookKey',p_catalog,p_catalog->'source',p_catalog->'metrics');
  update public.ready_workbook_catalogs set factory_job_id=p_job_id where passage_id=p_passage_id;
  update public.ready_workbook_factory_jobs set status='failed',failure_reason='Superseded by publisher re-import '||p_job_id::text where id<>p_job_id and status='ready' and source_metadata->>'sourceIdentity'=v_meta->>'sourceIdentity';
  update public.ready_workbook_factory_jobs set status='ready',passage_id=p_passage_id,extracted_rows=p_rows,metrics=p_catalog->'metrics',completed_at=now(),failure_reason='' where id=p_job_id;
  return p_passage_id;
end;
$$;

revoke all on function public.ready_apply_publisher_workbook_import(uuid,uuid,boolean,integer,integer,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ready_apply_publisher_workbook_import(uuid,uuid,boolean,integer,integer,text,jsonb,jsonb,jsonb) to service_role;
