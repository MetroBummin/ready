import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,extname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';

export const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const scratch=mkdtempSync(resolve(tmpdir(),'ready-api-'));
// Isolated in-memory PostgreSQL (PGlite) with every migration applied.
// Password hashing is stubbed, not tested here.
// No production URL, credentials, or external network is used.
export const pg=new PGlite();
await pg.exec("create role anon;create role authenticated;create role service_role;create schema extensions;create function extensions.crypt(text,text) returns text language sql as 'select md5($1)';create function extensions.gen_salt(text,integer) returns text language sql as 'select $1';create schema auth;create function auth.uid() returns uuid language sql as 'select null::uuid';");
for(const f of readdirSync(repo+'/supabase/migrations').filter(f=>f.endsWith('.sql')).sort()){
 try{await pg.exec(readFileSync(repo+'/supabase/migrations/'+f,'utf8').replace(/create extension if not exists pgcrypto;/gi,''));}catch(e){throw new Error(`${f}: ${e.message}`);}
}
// Expected API errors are logged by the Edge Function; keep test output quiet
// unless READY_TEST_VERBOSE=1.
const verbose=process.env.READY_TEST_VERBOSE==='1',log=(...args)=>{if(verbose)console.log(...args);},originalConsoleError=console.error;
if(!verbose)console.error=()=>{};
const qid=s=>'"'+s.replaceAll('"','""')+'"';
class Query {
 constructor(table){this.table=table;this.filters=[];this.sort=[];this.cols='*';this.op='select';this.params=[];}
 select(cols='*',options={}){this.cols=cols;this.options=options;return this;}
 eq(k,v){this.filters.push([k,'=',v]);return this;}neq(k,v){this.filters.push([k,'<>',v]);return this;}gte(k,v){this.filters.push([k,'>=',v]);return this;}gt(k,v){this.filters.push([k,'>',v]);return this;}lt(k,v){this.filters.push([k,'<',v]);return this;}lte(k,v){this.filters.push([k,'<=',v]);return this;}
 is(k,v){this.filters.push([k,'is',v]);return this;}in(k,v){this.filters.push([k,'in',v]);return this;}
 order(k,opt={}){this.sort.push(qid(k)+(opt.ascending===false?' desc':' asc'));return this;}limit(n){this.max=n;return this;}range(from,to){this.offset=Math.max(0,Number(from)||0);this.max=Math.max(0,(Number(to)||0)-this.offset+1);return this;}
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
  // Like PostgREST: `head` count queries return only the exact count, and every
  // other select is silently capped at max-rows (1000 by default; tests may
  // lower it through globalThis.__readyMaxRows to exercise paging).
  if(this.op==='select'&&this.options?.head){sql=sql.replace(/^select .*? from /,'select count(*)::integer as count from ');const result=await pg.query(sql,params);return {data:null,error:null,count:result.rows[0].count};}
  if(this.op==='select'){const cap=Number(globalThis.__readyMaxRows)||1000,max=Math.min(this.max||cap,cap);if(this.sort.length)sql+=' order by '+this.sort.join(',');sql+=' limit '+Number(max);if(this.offset)sql+=' offset '+Number(this.offset);}else sql+=' returning '+cols;
  const result=await pg.query(sql,params),rows=result.rows;
  if(this.required&&rows.length!==1)throw new Error('single row expected');
  let count=rows.length;
  if(this.op==='select'&&this.options?.count){const where=sql.match(/ where (.*?)(?: order by | limit |$)/)?.[1];count=(await pg.query(`select count(*)::integer as count from ${table}${where?' where '+where:''}`,params)).rows[0].count;}
  return {data:this.singleRow?rows[0]||null:rows,error:null,count};
 }catch(error){log('DB',this.table,error.message);return {data:null,error:{message:error.message,code:error.code}};}}
 then(resolve,reject){return this.execute().then(resolve,reject);}
}
const adapter={from:table=>new Query(table),rpc:async(name,args)=>{try{const keys=Object.keys(args),values=Object.values(args).map(v=>Array.isArray(v)&&v.length&&v.every(item=>typeof item==='string')?`{${v.map(item=>'"'+item.replaceAll('"','')+'"').join(',')}}`:Array.isArray(v)&&!v.length?'{}':typeof v==='object'&&v!==null?JSON.stringify(v):v);const result=await pg.query(`select * from public.${qid(name)}(${keys.map((k,i)=>qid(k)+'=> $'+(i+1)).join(',')})`,values);
// Like PostgREST: scalar functions return the value, table functions return rows.
const scalar=result.fields.length===1&&result.fields[0].name===name;return {data:scalar?result.rows[0]?.[name]??null:result.rows,error:null};}catch(error){log('RPC',name,error.message);return {data:null,error:{message:error.message,code:error.code}};}}};
globalThis.__readyDb=adapter;
const environment={SUPABASE_URL:'http://localhost',SUPABASE_SERVICE_ROLE_KEY:'local-test-only-service-role-key-0001',READY_ADMIN_PASSWORD:'ready-local'};
let handler;globalThis.Deno={env:{get:k=>environment[k]},serve:fn=>{handler=fn;}};
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{throw new Error('External network is forbidden in READY API tests: '+url);};
let source=readFileSync(repo+'/server/ready/index.ts','utf8').replace(/import \{ createClient \} from "[^"]+";/,'const createClient=()=>globalThis.__readyDb;');
source=source.replace(/(from\s*|import\()(["'])(\.[^"']+)\2/g,(_,lead,quote,path)=>lead+quote+pathToFileURL(resolve(repo+'/server/ready',path)).href+quote);
source+='\nexport {dispatch};';writeFileSync(resolve(scratch,'edge.mjs'),stripTypeScriptTypes(source,{mode:'transform'}));
export const {dispatch,READY_OPS,learningSince,mergePassageStructure}=await import(pathToFileURL(resolve(scratch,'edge.mjs')).href);
export async function request(op,data={},token='',headers={}) {return handler(new Request('http://localhost/api',{method:'POST',headers:{'content-type':'application/json',...headers,...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify({op,...data})}));}
export async function rawRequest(body,token=''){return handler(new Request('http://localhost/api',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body}));}
export async function call(op,data={},token=''){const res=await request(op,data,token),body=await res.json();if(!res.ok)throw Object.assign(new Error(body.error),{body,status:res.status});return body;}
export const admin=(await call('admin_login',{password:'ready-local'})).session.token;
export async function close(){await pg.close();globalThis.fetch=originalFetch;console.error=originalConsoleError;delete globalThis.Deno;delete globalThis.__readyDb;rmSync(scratch,{recursive:true,force:true});}
