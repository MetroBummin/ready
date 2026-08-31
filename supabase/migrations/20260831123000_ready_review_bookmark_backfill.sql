-- Review has one source of truth: bookmarks. Preserve existing students'
-- latest wrong answers by converting them to automatic bookmarks once.

insert into public.ready_question_bookmarks(student_id, exam_id, question_id, source, created_at, updated_at)
select latest.student_id, latest.exam_id, latest.question_id, 'wrong_answer', latest.created_at, latest.created_at
from (
  select distinct on (student_id, exam_id, question_id)
    student_id, exam_id, question_id, correct, created_at
  from public.ready_attempts
  order by student_id, exam_id, question_id, created_at desc
) latest
where latest.correct = false
on conflict (student_id, exam_id, question_id) do nothing;
