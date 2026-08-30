-- A textbook lesson is one learning object. Earlier imports split long lessons
-- into "· Part N" passages, which made boundary-spanning questions impossible
-- and let question sets drift between different canonical passages.
--
-- Merge only rows carrying that exact legacy suffix. Question/attempt and
-- reader-history identities are retained; duplicate per-passage word state is
-- folded into the canonical first part before foreign keys are moved.

create temporary table ready_textbook_part_merge on commit drop as
with parts as (
  select
    id,
    regexp_replace(source_label, '\s*·\s*Part\s+[0-9]+\s*$', '', 'i') as lesson_label,
    coalesce(nullif(substring(source_label from '(?i)Part\s+([0-9]+)\s*$'), '')::integer, 1) as part_no,
    display_order
  from public.ready_passages
  where source_type = 'TEXTBOOK'
    and source_label ~* '\s*·\s*Part\s+[0-9]+\s*$'
), ranked as (
  select *, first_value(id) over (
    partition by lesson_label order by part_no, display_order, id
  ) as keeper_id
  from parts
)
select id as part_id, keeper_id, lesson_label, part_no
from ranked;

-- Exam scope links have a composite identity. Remove only the redundant link
-- when the same exam already contains the canonical lesson.
delete from public.ready_exam_passages link
using ready_textbook_part_merge map
where link.passage_id = map.part_id
  and map.part_id <> map.keeper_id
  and exists (
    select 1 from public.ready_exam_passages kept
    where kept.exam_id = link.exam_id and kept.passage_id = map.keeper_id
  );

update public.ready_exam_passages link
set passage_id = map.keeper_id
from ready_textbook_part_merge map
where link.passage_id = map.part_id and map.part_id <> map.keeper_id;

-- Preserve one copy of equivalent saved meanings, and keep all distinct senses.
delete from public.ready_saved_words losing
using ready_textbook_part_merge map
where losing.passage_id = map.part_id
  and map.part_id <> map.keeper_id
  and exists (
    select 1 from public.ready_saved_words kept
    where kept.student_id = losing.student_id
      and kept.passage_id = map.keeper_id
      and kept.normalized_word = losing.normalized_word
      and kept.meaning_key = losing.meaning_key
  );

update public.ready_saved_words saved
set passage_id = map.keeper_id
from ready_textbook_part_merge map
where saved.passage_id = map.part_id and map.part_id <> map.keeper_id;

-- "Known" is boolean state. If either part was known, the merged lesson is known.
update public.ready_word_states kept
set known = kept.known or losing.known,
    updated_at = greatest(kept.updated_at, losing.updated_at)
from public.ready_word_states losing, ready_textbook_part_merge map
where losing.passage_id = map.part_id
  and map.part_id <> map.keeper_id
  and kept.passage_id = map.keeper_id
  and kept.student_id = losing.student_id
  and kept.normalized_word = losing.normalized_word;

delete from public.ready_word_states losing
using ready_textbook_part_merge map
where losing.passage_id = map.part_id
  and map.part_id <> map.keeper_id
  and exists (
    select 1 from public.ready_word_states kept
    where kept.student_id = losing.student_id
      and kept.passage_id = map.keeper_id
      and kept.normalized_word = losing.normalized_word
  );

update public.ready_word_states state
set passage_id = map.keeper_id
from ready_textbook_part_merge map
where state.passage_id = map.part_id and map.part_id <> map.keeper_id;

-- Sentence IDs remain unchanged, so saved-sentence and lookup links continue to
-- point to the exact same sentence. A large temporary index avoids collisions.
update public.ready_passage_sentences sentence
set sentence_index = 100000 + map.part_no * 1000 + sentence.sentence_index,
    passage_id = map.keeper_id
from ready_textbook_part_merge map
where sentence.passage_id = map.part_id;

with numbered as (
  select id, row_number() over (
    partition by passage_id order by sentence_index, id
  ) - 1 as next_index
  from public.ready_passage_sentences
  where passage_id in (select distinct keeper_id from ready_textbook_part_merge)
)
update public.ready_passage_sentences sentence
set sentence_index = numbered.next_index
from numbered
where sentence.id = numbered.id;

update public.ready_questions question
set passage_id = map.keeper_id
from ready_textbook_part_merge map
where question.passage_id = map.part_id and map.part_id <> map.keeper_id;

update public.ready_word_lookup_events event
set passage_id = map.keeper_id
from ready_textbook_part_merge map
where event.passage_id = map.part_id and map.part_id <> map.keeper_id;

update public.ready_sentence_translation_view_events event
set passage_id = map.keeper_id
from ready_textbook_part_merge map
where event.passage_id = map.part_id and map.part_id <> map.keeper_id;

update public.ready_saved_sentences saved
set passage_id = map.keeper_id
from ready_textbook_part_merge map
where saved.passage_id = map.part_id and map.part_id <> map.keeper_id;

-- Rebuild the canonical source text from the now-contiguous immutable rows.
update public.ready_passages passage
set title = map.lesson_label,
    source_label = map.lesson_label,
    source_text = source.full_text
from (
  select keeper_id, min(lesson_label) as lesson_label
  from ready_textbook_part_merge group by keeper_id
) map
join lateral (
  select string_agg(sentence.text, ' ' order by sentence.sentence_index) as full_text
  from public.ready_passage_sentences sentence
  where sentence.passage_id = map.keeper_id
) source on true
where passage.id = map.keeper_id;

delete from public.ready_passages passage
using ready_textbook_part_merge map
where passage.id = map.part_id and map.part_id <> map.keeper_id;
