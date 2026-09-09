import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,extname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';

export const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const scratch=mkdtempSync(resolve(tmpdir(),'ready-studio-api-'));
// Isolated PostgreSQL fixture: password hashing is stubbed, not tested here.
// No production URL, credentials, or external network is used.
export const pg=new PGlite();
await pg.exec("create role anon;create role authenticated;create role service_role;create schema extensions;create function extensions.crypt(text,text) returns text language sql as 'select md5($1)';create function extensions.gen_salt(text,integer) returns text language sql as 'select $1';create schema auth;create function auth.uid() returns uuid language sql as 'select null::uuid';");
for(const f of readdirSync(repo+'/supabase/migrations').filter(f=>f.endsWith('.sql')).sort()){
 try{await pg.exec(readFileSync(repo+'/supabase/migrations/'+f,'utf8').replace(/create extension if not exists pgcrypto;/gi,''));}catch(e){throw new Error(`${f}: ${e.message}`);}
}
const qid=s=>'"'+s.replaceAll('"','""')+'"';
class Query {
 constructor(table){this.table=table;this.filters=[];this.sort=[];this.cols='*';this.op='select';this.params=[];}
 select(cols='*',options={}){this.cols=cols;this.options=options;return this;}
 eq(k,v){this.filters.push([k,'=',v]);return this;}neq(k,v){this.filters.push([k,'<>',v]);return this;}gte(k,v){this.filters.push([k,'>=',v]);return this;}gt(k,v){this.filters.push([k,'>',v]);return this;}lt(k,v){this.filters.push([k,'<',v]);return this;}lte(k,v){this.filters.push([k,'<=',v]);return this;}
 is(k,v){this.filters.push([k,'is',v]);return this;}in(k,v){this.filters.push([k,'in',v]);return this;}
 order(k,opt={}){this.sort.push(qid(k)+(opt.ascending===false?' desc':' asc'));return this;}limit(n){this.max=n;return this;}
 maybeSingle(){this.singleRow=true;return this;}single(){this.singleRow=true;this.required=true;return this;}
 insert(value){this.op='insert';this.value=value;return this;}update(value){this.op='update';this.value=value;return this;}delete(){this.op='delete';return this;}upsert(value,options={}){this.op='insert';this.value=value;this.conflict=options;return this;}
 async execute(){try{
  const params=[],bind=(v,column='')=>{params.push(Array.isArray(v)&&column==='evidence_sentence_ids'?`{${v.join(',')}}`:typeof v==='object'&&v!==null?JSON.stringify(v):v);return '$'+params.length;};
  let sql='';const table=qid(this.table),cols=this.cols==='*'?'*':this.cols.split(',').map(qid).join(',');
  if(this.op==='insert'){
   const list=Array.isArray(this.value)?this.value:[this.value],keys=Object.keys(list[0]);sql=`insert into ${table} (${keys.map(qid)}) values ${list.map(row=>'('+keys.map(k=>bind(row[k],k)).join(',')+')').join(',')}`;
   if(this.conflict)sql+=` on conflict (${this.conflict.onConflict.split(',').map(qid)}) `+(this.conflict.ignoreDuplicates?'do nothing':'do update set '+keys.map(k=>`${qid(k)}=excluded.${qid(k)}`).join(','));
  }else if(this.op==='update')sql=`update ${table} set `+Object.entries(this.value).map(([k,v])=>qid(k)+'='+bind(v,k)).join(',');
  else if(this.op==='delete')sql=`delete from ${table}`;
  else sql=`select ${cols} from ${table}`;
  if(this.filters.length)sql+=' where '+this.filters.map(([k,op,v])=>op==='is'?qid(k)+(v===null?' is null':' is '+v):op==='in'?qid(k)+' in ('+v.map(bind).join(',')+')':qid(k)+op+bind(v)).join(' and ');
  if(this.op==='select'){if(this.sort.length)sql+=' order by '+this.sort.join(',');if(this.max)sql+=' limit '+Number(this.max);}else sql+=' returning '+cols;
  const result=await pg.query(sql,params),rows=result.rows;
  if(this.required&&rows.length!==1)throw new Error('single row expected');
  return {data:this.singleRow?rows[0]||null:rows,error:null,count:rows.length};
 }catch(error){console.log('DB',this.table,error.message);return {data:null,error:{message:error.message,code:error.code}};}}
 then(resolve,reject){return this.execute().then(resolve,reject);}
}
const adapter={from:table=>new Query(table),rpc:async(name,args)=>{try{const keys=Object.keys(args),values=Object.values(args).map(v=>typeof v==='object'&&v!==null?JSON.stringify(v):v);const result=await pg.query(`select public.${qid(name)}(${keys.map((k,i)=>qid(k)+'=> $'+(i+1)).join(',')}) as value`,values);return {data:result.rows[0]?.value,error:null};}catch(error){console.log('RPC',name,error.message);return {data:null,error:{message:error.message,code:error.code}};}}};
globalThis.__studioDb=adapter;
const environment={SUPABASE_URL:'http://localhost',SUPABASE_SERVICE_ROLE_KEY:'local-test-only',READY_ADMIN_PASSWORD:'studio-local',AI_PROVIDER:'gemini',GEMINI_API_KEY:'local-stub'};
let handler;globalThis.Deno={env:{get:k=>environment[k]},serve:fn=>{handler=fn;}};
export const aiCalls=[];const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 if(String(url).startsWith('https://generativelanguage.googleapis.com/')){
  const prompt=JSON.parse(options.body).contents[0].parts[0].text,inputs=JSON.parse(prompt.slice(prompt.indexOf('\n')+1));aiCalls.push(inputs.map(r=>r.sentenceId));
  const sentences=inputs.map(row=>{const first=row.englishTokens[0];return {sentenceId:row.sentenceId,english_blank:[{tokenStart:0,tokenEnd:Math.min(3,row.englishTokens.length)}],korean_blank:[{tokenStart:0,tokenEnd:1}],verb_form:[{tokenStart:0,tokenEnd:1,hint:first.toLowerCase(),answer:first}],grammar_choice:[{tokenStart:0,tokenEnd:1,correct:first,distractor:'incorrect'}]};});
  return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({sentences})}]}}]});
 }throw new Error('External network is forbidden in Studio API tests: '+url);
};
let source=readFileSync(repo+'/server/ready/index.ts','utf8').replace(/import \{ createClient \} from "[^"]+";/,'const createClient=()=>globalThis.__studioDb;');
source=source.replace(/(from\s*|import\()(["'])(\.[^"']+)\2/g,(_,lead,quote,path)=>lead+quote+pathToFileURL(resolve(repo+'/server/ready',path)).href+quote);
source+='\nexport {dispatch,geminiSentenceJson};';writeFileSync(resolve(scratch,'edge.mjs'),stripTypeScriptTypes(source,{mode:'transform'}));
export const {dispatch,geminiSentenceJson}=await import(pathToFileURL(resolve(scratch,'edge.mjs')).href);
export async function request(op,data={},token='') {return handler(new Request('http://localhost/api',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({op,...data})}));}
export async function call(op,data={},token=''){const res=await request(op,data,token),body=await res.json();if(!res.ok)throw Object.assign(new Error(body.error),{body,status:res.status});return body;}
export const admin=(await call('admin_login',{password:'studio-local'})).session.token;
export async function close(){await pg.close();globalThis.fetch=originalFetch;delete globalThis.Deno;delete globalThis.__studioDb;rmSync(scratch,{recursive:true,force:true});}
