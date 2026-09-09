create or replace function public.ready_publish_content_claim_bank(p_passage_id uuid)
returns table(facts_confirmed bigint, claims_confirmed bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_facts bigint;
  v_claims bigint;
begin
  update public.ready_content_claims
  set status = 'confirmed'
  where passage_id = p_passage_id;
  get diagnostics v_claims = row_count;

  update public.ready_content_facts
  set status = 'confirmed'
  where passage_id = p_passage_id;
  get diagnostics v_facts = row_count;

  return query select v_facts, v_claims;
end;
$$;

revoke all on function public.ready_publish_content_claim_bank(uuid)
from public, anon, authenticated;
grant execute on function public.ready_publish_content_claim_bank(uuid)
to service_role;
