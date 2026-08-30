-- READY Question MVP: the generic Question payload remains the source of
-- question-specific structure. This index serves the only active student read:
-- available multiple-choice questions for one Passage.
create index if not exists ready_questions_available_passage_idx
  on public.ready_questions(passage_id, created_at)
  where status = 'available' and type = 'multiple_choice';
