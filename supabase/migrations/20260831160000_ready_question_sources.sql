-- Source is queue metadata only. Existing production rows all originated from
-- Exam4you; future imports must author exam4you or nernter explicitly.
update public.ready_questions
set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{source,provider}', '"exam4you"'::jsonb, true)
where coalesce(payload #>> '{source,provider}', '') = '';

create index if not exists ready_questions_source_provider_idx
on public.ready_questions ((payload #>> '{source,provider}'))
where status = 'available';

-- These rows were withdrawn by the new general round-trip gates (span
-- closure, inactive device, or passage-evidence coverage). The identifiers
-- are data produced by the validator, not renderer exceptions.
update public.ready_questions
set status = 'draft',
    payload = jsonb_set(jsonb_set(payload, '{import_status}', '"drop"'::jsonb, true), '{spec,importStatus}', '"drop"'::jsonb, true),
    updated_at = now()
where id = any(array[
  '02667cbc-c1b1-428a-b7d2-f2cdce9ca555'::uuid,
  '26f6deae-0765-40dd-a8f3-4a5be2531296'::uuid,
  '4454ba5a-a34f-49cd-bf98-8f8428e984e2'::uuid,
  'ad7f72fe-7876-4ab0-b6c1-d921d51b21a3'::uuid,
  'cd619860-4c61-4109-9b0a-88a7a6dec216'::uuid,
  'e2c4b42c-3d85-4ce7-87d2-7d2b33d2bd68'::uuid,
  'e2d122f8-80b4-4a93-beda-c12529cc567c'::uuid
]);
