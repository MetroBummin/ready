-- One lexical meaning per lookup/save. Lookup events remain append-only history.
alter table public.ready_word_lookup_events
  add column if not exists meaning_snapshot text,
  add column if not exists source_kind text not null default 'reader',
  add column if not exists source_key text;

update public.ready_word_lookup_events
set meaning_snapshot = coalesce(core_meaning_snapshot, gloss_snapshot)
where meaning_snapshot is null;

alter table public.ready_word_lookup_events
  drop constraint if exists ready_word_lookup_source_kind_valid,
  add constraint ready_word_lookup_source_kind_valid
    check (source_kind in ('reader', 'question', 'workbook'));

alter table public.ready_saved_words
  drop constraint if exists ready_saved_words_core_meanings_array,
  drop column if exists core_meanings;

alter table public.ready_word_lookup_events
  drop column if exists core_meaning_snapshot,
  drop column if exists gloss_snapshot;

create index if not exists ready_word_lookup_surface_history_idx
  on public.ready_word_lookup_events(student_id, exam_id, source_kind, source_key, created_at desc)
  where resolved = true;
