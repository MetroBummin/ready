-- Remove a production-only index from the retired Passage.exam_id/position path.
-- The compatibility columns and their data remain untouched; current membership
-- is sourced exclusively from ready_exam_passages.
drop index if exists public.ready_passages_exam_position_idx;
