-- Reader-only contextual gloss experiment. Existing lookup events remain the
-- single event stream; these nullable snapshots do not revive SavedWord UI.
alter table public.ready_word_lookup_events
  add column if not exists source_text_snapshot text,
  add column if not exists start_offset integer,
  add column if not exists end_offset integer,
  add column if not exists gloss_snapshot text,
  add column if not exists lemma_snapshot text,
  add column if not exists lookup_kind text,
  add column if not exists confidence numeric,
  add column if not exists passage_revision timestamptz;

alter table public.ready_word_lookup_events
  drop constraint if exists ready_word_lookup_offsets_valid,
  add constraint ready_word_lookup_offsets_valid check (
    (start_offset is null and end_offset is null)
    or (start_offset >= 0 and end_offset > start_offset)
  ),
  drop constraint if exists ready_word_lookup_kind_valid,
  add constraint ready_word_lookup_kind_valid check (lookup_kind is null or lookup_kind in ('word','phrase')),
  drop constraint if exists ready_word_lookup_confidence_valid,
  add constraint ready_word_lookup_confidence_valid check (confidence is null or (confidence >= 0 and confidence <= 1));
