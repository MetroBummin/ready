-- Migration history marker.
--
-- Production recorded this version during the scope-group follow-up rollout,
-- while the complete idempotent schema/data repair is tracked in
-- 20260904051836_scope_group_followups.sql. Keeping this no-op marker in git
-- makes fresh and linked migration histories agree without replaying or
-- reverting production data.

select 1;
