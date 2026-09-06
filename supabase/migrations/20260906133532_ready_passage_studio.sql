-- Small additive Studio state; no production catalog/history migration.
alter table public.ready_passages add column if not exists studio_state jsonb;

create or replace function public.ready_save_studio_state(
 p_passage_id uuid,p_expected_revision integer,p_expected_version integer,p_state jsonb,
 p_catalog jsonb default null
) returns void language plpgsql security invoker set search_path='' as $$
declare v_passage public.ready_passages;
begin
 select * into v_passage from public.ready_passages where id=p_passage_id for update;
 if not found or v_passage.canonical_revision<>p_expected_revision then raise exception 'Passage가 변경되었습니다. 다시 열어 주세요.'; end if;
 if coalesce((v_passage.studio_state->>'version')::integer,0)<>p_expected_version then raise exception '다른 창에서 Authoring을 저장했습니다. 다시 열어 주세요.'; end if;
 update public.ready_passages set studio_state=p_state||jsonb_build_object('version',p_expected_version+1),
 ai_regeneration_required=coalesce((p_state->>'needsReview')::boolean,true) where id=p_passage_id;
 if p_catalog is not null then
   perform public.ready_publish_deterministic_catalog(p_passage_id,p_expected_revision,p_catalog->>'workbookKey',p_catalog,p_catalog->'source',p_catalog->'metrics');
 end if;
end;$$;
revoke all on function public.ready_save_studio_state(uuid,integer,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ready_save_studio_state(uuid,integer,integer,jsonb,jsonb) to service_role;

create or replace function public.ready_studio_create_draft(p_job_id uuid,p_rows jsonb,p_title text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_job public.ready_workbook_factory_jobs;v_id uuid;v_meta jsonb;
begin
 select * into v_job from public.ready_workbook_factory_jobs where id=p_job_id for update;
 if not found then raise exception 'Import를 찾지 못했습니다.'; end if;
 if v_job.passage_id is not null then return v_job.passage_id; end if;
 v_meta:=v_job.source_metadata;
 v_id:=public.ready_create_passage_with_sentences(p_title,coalesce(v_meta->>'sourceType','MOCK_EXAM'),coalesce(v_meta->>'grade','2학년'),nullif(v_meta->>'sourceYear','')::integer,nullif(v_meta->>'sourceMonth','')::integer,coalesce(v_meta->>'sourceLabel',''),p_rows);
 update public.ready_passages set studio_state=jsonb_build_object('version',0,'published',false,'needsReview',true,'jobId',p_job_id,'annotations','{}'::jsonb) where id=v_id;
 update public.ready_workbook_factory_jobs set passage_id=v_id,extracted_rows=p_rows,title=p_title where id=p_job_id;
 return v_id;
end;$$;
revoke all on function public.ready_studio_create_draft(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.ready_studio_create_draft(uuid,jsonb,text) to service_role;
