import assert from 'node:assert/strict';
import {call,admin,geminiSentenceJson,close} from './helpers/ready-studio-api.mjs';
const normalFetch=globalThis.fetch,normalError=console.error;
let calls=[],logs=[];
console.error=(...args)=>logs.push(args.join(' '));
const ok=value=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]});
function sequence(statuses,result={translation:'그는 책을 읽는다.'}){
 calls=[];logs=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url:String(url),...JSON.parse(options.body)});
  const status=statuses.shift();
  if(status==='network')throw new TypeError('network failed');
  if(status===200)return ok(result);
  return Response.json({error:{code:status,status:'TEST_PROVIDER_ERROR',message:'invalid local-stub argument'}},{status});
 };
}
try{
 sequence([400,200]);assert.equal((await geminiSentenceJson('test')).translation,'그는 책을 읽는다.');
 assert.equal(calls.length,2);assert.ok(calls[0].generationConfig.thinkingConfig);assert.equal(calls[1].generationConfig.thinkingConfig,undefined);
 assert.equal(calls[1].generationConfig.responseMimeType,'application/json');assert.equal(calls[0].url,calls[1].url);
 assert.match(logs[0],/gemini-3.5-flash-lite/);assert.match(logs[0],/400/);assert.match(logs[0],/TEST_PROVIDER_ERROR/);assert.ok(!logs.join('').includes('local-stub'));
 for(const status of [404,408,429,500,502,503,504,'network']){
  sequence([status,200]);await geminiSentenceJson('test');assert.equal(calls.length,2);assert.match(calls[1].url,/gemini-2.5-flash-lite/);
 }
 sequence([400,400,200]);await geminiSentenceJson('test');assert.equal(calls.length,3);assert.match(calls[2].url,/gemini-2.5-flash-lite/);
 for(const status of [401,403]){sequence([status]);await assert.rejects(()=>geminiSentenceJson('test'),e=>e.status===503&&/API 키/.test(e.message));assert.equal(calls.length,1);}
 sequence([422]);await assert.rejects(()=>geminiSentenceJson('test'),e=>e.status===502);assert.equal(calls.length,1);
 sequence([429,429]);await assert.rejects(()=>geminiSentenceJson('test'),e=>e.status===429);
 sequence([400,400,400,400]);await assert.rejects(()=>geminiSentenceJson('test'),e=>e.status===502);assert.equal(calls.length,4);
 sequence([200],[]);await assert.rejects(()=>geminiSentenceJson('test'),/결과 형식/);
 // Exercise real Studio handlers and an isolated PostgreSQL database.
 const draft=(await call('studio_import',{title:'Gemini recovery QA',sourceKind:'text',sourceText:'He reads a book.\t그는 책을 읽는다.',sourceType:'TEXTBOOK',grade:'2학년'},admin)).drafts[0];
 const saved=await call('studio_create_draft',{jobId:draft.job.id,title:draft.job.title,rows:draft.rows,boundaryConfirmed:true},admin);
 const context=await call('studio_open',{passageId:saved.passageId},admin);
 calls=[];let rejected=false;
 globalThis.fetch=async(url,options)=>{
  calls.push(JSON.parse(options.body));
  if(!rejected){rejected=true;return Response.json({error:{code:400,status:'INVALID_ARGUMENT',message:'Request contains an invalid argument.'}},{status:400});}
  return normalFetch(url,options);
 };
 const authored=await call('studio_author',{passageId:saved.passageId,revision:context.passage.canonical_revision,version:context.studio.version},admin);
 assert.ok(authored.studio);assert.equal(calls.length,2);assert.equal(calls[1].generationConfig.thinkingConfig,undefined);
 sequence([400,200]);
 const translated=await call('studio_easy_translation',{passageId:saved.passageId,sentenceId:context.rows[0].id},admin);
 assert.equal(translated.translation,'그는 책을 읽는다.');assert.equal(calls.length,2);
 normalError('PASS Gemini sentence: config recovery, provider fallback, terminal auth, redacted diagnostics, real Studio Authoring + translation handlers.');
}finally{console.error=normalError;await close();}
