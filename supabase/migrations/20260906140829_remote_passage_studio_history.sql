-- Migration history marker.
--
-- Production recorded the Passage Studio rollout with this version while the
-- complete idempotent schema is tracked in
-- 20260906133532_ready_passage_studio.sql. Keeping this no-op marker in git
-- makes fresh and linked migration histories agree without reverting data.

select 1;
