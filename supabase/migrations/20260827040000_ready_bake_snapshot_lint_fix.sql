-- Replace temporary-table snapshots with transaction-local JSON snapshots.
-- This keeps rebake remapping atomic while remaining fully inspectable by
-- Supabase's plpgsql checker.
create or replace function public.ready_apply_passage_bake(p_passage_id uuid,p_generation integer,p_bake jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare s jsonb; t jsonb; c jsonb; saved jsonb; v_concept_id uuid; v_old_concept_id uuid; v_token_ids uuid[]; v_incoming_key text; v_old_occurrences jsonb; v_saved_sources jsonb;
begin
  if jsonb_typeof(p_bake->'sentences') <> 'array' then raise exception 'Bake sentences array is required.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('sentenceId',sentence_id,'occurrenceKey',occurrence_key,'conceptId',concept_id)),'[]'::jsonb)
  into v_old_occurrences from ready_lexical_occurrences where passage_id=p_passage_id;
  select coalesce(jsonb_agg(jsonb_build_object('savedItemId',src.saved_item_id,'sentenceId',src.sentence_id,'occurrenceKey',occurrence.occurrence_key,'surfaceText',src.surface_text)),'[]'::jsonb)
  into v_saved_sources from ready_saved_lexical_sources src join ready_lexical_occurrences occurrence on occurrence.id=src.occurrence_id
  where src.passage_id=p_passage_id;

  delete from ready_lexical_occurrences where passage_id=p_passage_id;
  delete from ready_sentence_tokens where passage_id=p_passage_id;
  delete from ready_sentence_bakes where passage_id=p_passage_id;
  for s in select * from jsonb_array_elements(p_bake->'sentences') loop
    if not exists(select 1 from ready_passage_sentences where id=(s->>'sentenceId')::uuid and passage_id=p_passage_id) then raise exception 'Bake contains a foreign sentence.'; end if;
    insert into ready_sentence_bakes(sentence_id,passage_id,structure_summary,grammar_points,key_expressions,difficulty,generation)
    values((s->>'sentenceId')::uuid,p_passage_id,coalesce(s->>'structureSummary',''),coalesce(s->'grammarPoints','[]'),coalesce(s->'keyExpressions','[]'),s->>'difficulty',p_generation);
    for t in select * from jsonb_array_elements(s->'tokens') loop
      insert into ready_sentence_tokens(sentence_id,passage_id,token_index,surface,normalized,lemma,start_offset,end_offset)
      values((s->>'sentenceId')::uuid,p_passage_id,(t->>'tokenIndex')::integer,t->>'surface',t->>'normalized',t->>'lemma',(t->>'startOffset')::integer,(t->>'endOffset')::integer);
    end loop;
    for c in select * from jsonb_array_elements(coalesce(s->'concepts','[]')) loop
      v_incoming_key:=c->>'conceptKey'; v_concept_id:=null; v_old_concept_id:=null;
      select concept_id into v_concept_id from ready_lexical_concept_aliases where alias_key=v_incoming_key;
      if v_concept_id is null then select id into v_concept_id from ready_lexical_concepts where concept_key=v_incoming_key; end if;
      select (old_item->>'conceptId')::uuid into v_old_concept_id
      from jsonb_array_elements(v_old_occurrences) old_item
      where old_item->>'sentenceId'=s->>'sentenceId' and old_item->>'occurrenceKey'=c->>'occurrenceKey' limit 1;
      if v_old_concept_id is not null then v_concept_id:=v_old_concept_id; end if;
      if v_concept_id is null then
        insert into ready_lexical_concepts(concept_key,kind,canonical_form,lemma,sense_key,part_of_speech,context_meaning,alternative_senses)
        values(v_incoming_key,c->>'kind',c->>'canonicalForm',nullif(c->>'lemma',''),c->>'senseKey',nullif(c->>'partOfSpeech',''),c->>'contextMeaning',coalesce(c->'alternativeSenses','[]')) returning id into v_concept_id;
      else
        update ready_lexical_concepts set context_meaning=c->>'contextMeaning',alternative_senses=coalesce(c->'alternativeSenses','[]'),updated_at=now() where id=v_concept_id;
      end if;
      insert into ready_lexical_concept_aliases(alias_key,concept_id) values(v_incoming_key,v_concept_id)
      on conflict(alias_key) do nothing;
      select array_agg(tok.id order by ord.n) into v_token_ids
      from jsonb_array_elements_text(c->'tokenIndexes') with ordinality ord(value,n)
      join ready_sentence_tokens tok on tok.sentence_id=(s->>'sentenceId')::uuid and tok.token_index=ord.value::integer;
      if cardinality(v_token_ids) <> jsonb_array_length(c->'tokenIndexes') then raise exception 'Bake token mapping is invalid.'; end if;
      insert into ready_lexical_occurrences(passage_id,sentence_id,concept_id,occurrence_key,surface_text,token_ids,specificity)
      values(p_passage_id,(s->>'sentenceId')::uuid,v_concept_id,c->>'occurrenceKey',c->>'surfaceText',v_token_ids,cardinality(v_token_ids));
    end loop;
  end loop;
  for saved in select * from jsonb_array_elements(v_saved_sources) loop
    insert into ready_saved_lexical_sources(saved_item_id,occurrence_id,passage_id,sentence_id,surface_text)
    select (saved->>'savedItemId')::uuid,occurrence.id,p_passage_id,occurrence.sentence_id,saved->>'surfaceText'
    from ready_lexical_occurrences occurrence
    where occurrence.sentence_id=(saved->>'sentenceId')::uuid and occurrence.occurrence_key=saved->>'occurrenceKey'
    on conflict do nothing;
  end loop;
  update ready_passages set bake_status='ready',bake_generation=p_generation,baked_at=now(),bake_error=null where id=p_passage_id;
end $$;
