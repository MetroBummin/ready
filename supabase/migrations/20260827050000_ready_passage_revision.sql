-- Reader cache revisions need a durable passage-level update timestamp.
-- This is additive and keeps existing production passages valid.
alter table public.ready_passages
  add column if not exists updated_at timestamptz;

update public.ready_passages
set updated_at = coalesce(updated_at, baked_at, created_at, now())
where updated_at is null;

alter table public.ready_passages
  alter column updated_at set default now(),
  alter column updated_at set not null;

create or replace function public.ready_touch_passage_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ready_passages_touch_updated_at on public.ready_passages;
create trigger ready_passages_touch_updated_at
before update on public.ready_passages
for each row execute function public.ready_touch_passage_updated_at();
