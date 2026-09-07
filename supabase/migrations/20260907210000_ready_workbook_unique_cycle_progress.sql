-- Workbook progress is cycle-based: an item contributes at most once to the
-- current cycle, and a cycle completes only after every stage item is clear.
alter table public.ready_workbook_attempts
  add column if not exists stage_item_count integer check (stage_item_count > 0);

alter table public.ready_workbook_stage_progress
  add column if not exists completed_cycles bigint not null default 0 check (completed_cycles >= 0),
  add column if not exists current_cycle bigint not null default 1 check (current_cycle >= 1);

create table if not exists public.ready_workbook_cycle_item_clears (
  student_id uuid not null references public.ready_students(id) on delete cascade,
  exam_id uuid not null references public.ready_exams(id) on delete cascade,
  passage_id uuid not null references public.ready_passages(id) on delete cascade,
  workbook_key text not null check (char_length(workbook_key) between 1 and 120),
  stage_contract_version text not null,
  progress_key text not null check (char_length(progress_key) between 1 and 80),
  cycle_number bigint not null check (cycle_number >= 1),
  item_key text not null check (char_length(item_key) between 1 and 160),
  cleared_at timestamptz not null,
  primary key (
    student_id, exam_id, passage_id, workbook_key, stage_contract_version,
    progress_key, cycle_number, item_key
  )
);

create index if not exists ready_workbook_cycle_item_clears_scope_idx
  on public.ready_workbook_cycle_item_clears(
    student_id, exam_id, passage_id, workbook_key, stage_contract_version, progress_key, cycle_number
  );

create or replace function public.ready_record_workbook_cycle_clear(
  p_student_id uuid,
  p_exam_id uuid,
  p_passage_id uuid,
  p_workbook_key text,
  p_stage_contract_version text,
  p_semantic_type text,
  p_stage smallint,
  p_item_key text,
  p_stage_item_count integer,
  p_cleared_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract text := coalesce(nullif(p_stage_contract_version, ''), 'legacy-v1');
  v_progress_key text := coalesce(nullif(p_semantic_type, ''), 'stage:' || p_stage::text);
  v_cycle bigint;
  v_completed bigint;
  v_cycle_clears integer;
  v_inserted integer;
begin
  if coalesce(p_stage_item_count, 0) <= 0 then return; end if;

  insert into public.ready_workbook_stage_progress (
    student_id, exam_id, passage_id, workbook_key, stage_contract_version,
    progress_key, semantic_type, stage, correct_clears, completed_cycles, current_cycle, updated_at
  ) values (
    p_student_id, p_exam_id, p_passage_id, p_workbook_key, v_contract,
    v_progress_key, nullif(p_semantic_type, ''), p_stage, 0, 0, 1, p_cleared_at
  )
  on conflict (student_id, exam_id, passage_id, workbook_key, stage_contract_version, progress_key)
  do nothing;

  select completed_cycles, current_cycle into v_completed, v_cycle
  from public.ready_workbook_stage_progress
  where student_id = p_student_id and exam_id = p_exam_id and passage_id = p_passage_id
    and workbook_key = p_workbook_key and stage_contract_version = v_contract
    and progress_key = v_progress_key
  for update;

  insert into public.ready_workbook_cycle_item_clears (
    student_id, exam_id, passage_id, workbook_key, stage_contract_version,
    progress_key, cycle_number, item_key, cleared_at
  ) values (
    p_student_id, p_exam_id, p_passage_id, p_workbook_key, v_contract,
    v_progress_key, v_cycle, p_item_key, p_cleared_at
  ) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return; end if;

  select count(*)::integer into v_cycle_clears
  from public.ready_workbook_cycle_item_clears
  where student_id = p_student_id and exam_id = p_exam_id and passage_id = p_passage_id
    and workbook_key = p_workbook_key and stage_contract_version = v_contract
    and progress_key = v_progress_key and cycle_number = v_cycle;

  if v_cycle_clears >= p_stage_item_count then
    delete from public.ready_workbook_cycle_item_clears
    where student_id = p_student_id and exam_id = p_exam_id and passage_id = p_passage_id
      and workbook_key = p_workbook_key and stage_contract_version = v_contract
      and progress_key = v_progress_key and cycle_number = v_cycle;
    v_completed := v_completed + 1;
    v_cycle := v_cycle + 1;
    v_cycle_clears := 0;
  end if;

  update public.ready_workbook_stage_progress set
    correct_clears = v_completed * p_stage_item_count + v_cycle_clears,
    completed_cycles = v_completed,
    current_cycle = v_cycle,
    semantic_type = nullif(p_semantic_type, ''),
    stage = p_stage,
    updated_at = p_cleared_at
  where student_id = p_student_id and exam_id = p_exam_id and passage_id = p_passage_id
    and workbook_key = p_workbook_key and stage_contract_version = v_contract
    and progress_key = v_progress_key;
  return;
end;
$$;

create or replace function public.ready_increment_workbook_stage_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.correct is true then
    perform public.ready_record_workbook_cycle_clear(
      new.student_id, new.exam_id, new.passage_id, new.workbook_key,
      new.stage_contract_version, new.semantic_type, new.stage, new.item_key,
      new.stage_item_count, new.created_at
    );
  end if;
  return new;
end;
$$;

-- Recover stage sizes from the catalog snapshot without mutating append-only
-- attempts, then replay correct history chronologically.
delete from public.ready_workbook_cycle_item_clears;
delete from public.ready_workbook_stage_progress;

do $$
declare
  replay record;
begin
  for replay in
    select ranked.* from (
      select a.*, jsonb_array_length(stage.value->'items') as replay_stage_item_count,
        row_number() over (partition by a.id order by catalog.updated_at desc) as catalog_position
      from public.ready_workbook_attempts a
      join public.ready_workbook_catalogs catalog
        on catalog.passage_id = a.passage_id and catalog.workbook_key = a.workbook_key
      cross join lateral jsonb_array_elements(catalog.catalog->'stages') stage(value)
      where a.correct is true and (stage.value->>'stage')::integer = a.stage
    ) ranked
    where ranked.catalog_position = 1 and ranked.replay_stage_item_count > 0
    order by ranked.created_at, ranked.id
  loop
    perform public.ready_record_workbook_cycle_clear(
      replay.student_id, replay.exam_id, replay.passage_id, replay.workbook_key,
      replay.stage_contract_version, replay.semantic_type, replay.stage, replay.item_key,
      replay.replay_stage_item_count, replay.created_at
    );
  end loop;
end;
$$;

alter table public.ready_workbook_cycle_item_clears enable row level security;
revoke all on public.ready_workbook_cycle_item_clears from anon, authenticated;
grant all on public.ready_workbook_cycle_item_clears to service_role;
revoke all on function public.ready_increment_workbook_stage_progress() from public, anon, authenticated;
grant execute on function public.ready_increment_workbook_stage_progress() to service_role;
revoke all on function public.ready_record_workbook_cycle_clear(uuid,uuid,uuid,text,text,text,smallint,text,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.ready_record_workbook_cycle_clear(uuid,uuid,uuid,text,text,text,smallint,text,integer,timestamptz) to service_role;

comment on table public.ready_workbook_stage_progress is
  'Cycle progress summary. correct_clears equals completed cycles times stage size plus unique clears in the current cycle.';
comment on table public.ready_workbook_cycle_item_clears is
  'Bounded unique item clears for the current Workbook stage cycle; attempts preserve completed-cycle history.';
