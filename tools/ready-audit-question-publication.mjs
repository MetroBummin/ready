#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { CURRENT_QUESTION_PUBLICATION_VERSION } from '../server/ready/question-pipeline.mjs';

const args=process.argv.slice(2),value=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:'';};
const exam=value('--exam'),type=value('--type');
const filters=[exam?`payload->'source'->>'exam'=${sql(exam)}`:'',type?`type=${sql(type)}`:''].filter(Boolean);
const where=filters.length?`where ${filters.join(' and ')}`:'';
const version=`case when coalesce(payload->>'publication_version','') ~ '^\\d+$' then (payload->>'publication_version')::int else 0 end`;
const query=`select payload->'source'->>'exam' exam,type,status,case when ${version}>=${CURRENT_QUESTION_PUBLICATION_VERSION} then 'CURRENT' else 'STALE' end publication_status,count(*)::int items from public.ready_questions ${where} group by 1,2,3,4 order by 1,2,3,4;`;
const run=spawnSync('npx',['supabase','db','query','--linked','--output','json',query],{encoding:'utf8',maxBuffer:16*1024*1024});
if(run.status!==0)throw new Error(run.stderr||run.stdout||`supabase exited ${run.status}`);
const rows=JSON.parse(run.stdout).rows||[];
for(const row of rows)console.log(`${row.exam||'UNKNOWN'} · ${row.type} · ${row.status} · ${row.items} items ${row.publication_status}`);
if(rows.some(row=>row.status==='available'&&row.publication_status==='STALE'))process.exitCode=1;

function sql(input){return `'${String(input).replaceAll("'","''")}'`;}
