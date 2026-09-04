alter table public.ready_workbook_attempts
  add column if not exists stage_contract_version text not null default 'legacy-v1',
  add column if not exists semantic_type text;

alter table public.ready_workbook_bookmarks
  add column if not exists stage_contract_version text not null default 'legacy-v1',
  add column if not exists semantic_type text;

comment on column public.ready_workbook_attempts.stage_contract_version is
  'legacy-v1 preserves historical printed-stage identity; semantic-v2 uses READY semantic stages 1-7.';
comment on column public.ready_workbook_attempts.semantic_type is
  'Stable semantic activity id. Null for historical legacy attempts.';
