import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import * as progress from '../ready/workbook-progress.js';

// Execute the actual Student functions with controlled transport/storage/idle work.
// No production data or browser-only timing is needed to reproduce these races.
const app=process.env.READY_AUDIT_BASE
  ? execFileSync('git',['show',`${process.env.READY_AUDIT_BASE}:ready/app.js`],{encoding:'utf8'})
  : readFileSync(new URL('../ready/app.js',import.meta.url),'utf8');
const source=app.slice(0,app.indexOf("document.addEventListener('pointerdown',beginNavPointer)")).replace(/^import .*;\n/gm,'');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(storage=new Map()){
  const requests=[],timers=new Map(),idle=[];let nextTimer=0;
  const review={hidden:true},workbook={hidden:true};
  const context=vm.createContext({...progress,console,Map,Set,WeakMap,JSON,Number,Promise,structuredClone,
    document:{querySelector:selector=>selector==='#student-review'?review:selector==='#student-workbook'?workbook:null},
    window:{requestIdleCallback:fn=>idle.push(fn)},requestIdleCallback:fn=>idle.push(fn),
    setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id),
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    readyApi:(op,body,token,options)=>{const d=deferred();requests.push({op,body,token,options,...d});return d.promise;},
  });
  vm.runInContext(source+`\nupdateStudentNav=()=>{};showStudentLogin=()=>{};renderReview=()=>{};renderScope=()=>{};renderWorkbook=()=>{};renderWorkbookStages=()=>{};refreshWorkbookSubmit=()=>{};call=(op,data,token)=>readyApi(op,data,token);
    globalThis.test={state,clearSession,restoreWorkbookAttempts,queueWorkbookAttempt,flushWorkbookAttempts,workbookAttemptStorageKey,
      loadReviewKind,invalidateReviewKind,removeReviewWord,updateReviewWordMeaning,ensureReviewData,prefetchWorkbooks,prefetchReview,openWorkbook,cacheWorkbook,
      repeatWorkbookCycle,chooseOtherWorkbook,setWorkbookStage,requestWorkbookHint,
      get queue(){return workbookAttemptQueue;}};`,context);
  const api=context.test;
  const login=(token='student-A-token-000000000001')=>{api.state.token=token;api.state.student={id:token};api.state.scope={id:'scope'};};login();
  return {api,requests,storage,timers,idle,review,workbook,login};
}
const body=id=>({clientAttemptId:id,itemKey:'item',passageId:'passage',examId:'scope',responses:['answer']});
const ack=id=>({attempt:{id},correct:true,correctClears:1,reviewCount:0});
const tests=[];const test=(name,run)=>tests.push({name,run});
function completedCycleFixture(h){
  const first={key:'first',stage:9,slotCount:1,completed:true,lastResult:true,bookmarked:true},second={key:'second',stage:9,slotCount:1,completed:true,lastResult:true,bookmarked:false};
  const stage={stage:9,semanticType:'writing',total:2,correctClears:6,completedCycles:3,currentCycle:4,currentCycleClears:[],progressPercent:300,items:[first,second]};
  const session={data:{stages:[stage]},passageId:'passage',stageIndex:0,itemIndex:1,responses:{first:['old first'],second:['old second']},results:{first:{correct:true,persistenceSequence:7},second:{correct:true,persistenceSequence:8}},orderSelections:{first:[[0]],second:[[1]]},orderConsumedChips:{first:[[0]],second:[[1]]},orderWrongChips:{first:[{chipIndex:0,sequence:1}],second:[null]},orderBatchOrders:{first:[[0]],second:[[1]]},orderModeSnapshot:{stage,item:second,mode:'practice'},assistance:{first:{hintUsed:true,hintReceipt:'old',hints:{0:'old'},live:{0:{valid:false}},requestSequence:{0:1}},second:{hintUsed:true,hintReceipt:'old',hints:{}}},aiPending:{first:true},aiErrors:{second:'old error'},persistenceSequence:{first:7,second:8},milestone:{stageIndex:0,percent:300},acknowledgedMilestones:{writing:300},focusedSlot:1};
  h.api.state.workbookSession=session;h.api.state.reviewCount=9;
  return {session,stage,first,second};
}
test('in-flight reload keeps the same durable ID and overlapping flush sends once',async()=>{
  const h=harness();h.api.queueWorkbookAttempt(null,null,body('one'),0);const key=h.api.workbookAttemptStorageKey();
  const pending=h.api.flushWorkbookAttempts(),overlap=h.api.flushWorkbookAttempts({keepalive:true});
  assert.equal(JSON.parse(h.storage.get(key)).length,1,'in-flight request must remain durable');
  assert.equal(h.requests.length,1);
  const reloaded=harness(h.storage);reloaded.api.restoreWorkbookAttempts();
  assert.equal(reloaded.api.queue[0].body.clientAttemptId,'one');
  h.requests[0].resolve({results:[ack('saved')]});await Promise.all([pending,overlap]);
  assert.equal(JSON.parse(h.storage.get(key)).length,0);
});
test('failed/absent acknowledgements remain ordered and later enqueue is preserved',async()=>{
  const h=harness();for(const id of ['one','two','three'])h.api.queueWorkbookAttempt(null,null,body(id),0);
  const p=h.api.flushWorkbookAttempts();h.api.queueWorkbookAttempt(null,null,body('four'),0);
  h.requests[0].resolve({results:[ack('one'),{error:'retry'}]});await p;
  assert.deepEqual(Array.from(h.api.queue,e=>e.body.clientAttemptId),['two','three','four']);
  const retry=h.api.flushWorkbookAttempts();h.requests[1].reject(new Error('offline'));await retry;
  assert.deepEqual(JSON.parse(h.storage.get(h.api.workbookAttemptStorageKey())).map(e=>e.clientAttemptId),['two','three','four']);
});
test('restored backlog precedes a submission made before dashboard revalidation',async()=>{
  const h=harness();h.storage.set(h.api.workbookAttemptStorageKey(),JSON.stringify([body('old')]));
  h.api.queueWorkbookAttempt(null,null,body('new'),0);
  assert.deepEqual(Array.from(h.api.queue,e=>e.body.clientAttemptId),['old','new']);
});
test('late success/failure cannot submit A records as B or overwrite B storage/UI',async()=>{
  for(const success of [true,false]){
    const h=harness();h.api.queueWorkbookAttempt(null,null,body('A'),0);const keyA=h.api.workbookAttemptStorageKey();
    const a=h.api.flushWorkbookAttempts();h.api.clearSession();h.login('student-B-token-000000000002');
    h.api.queueWorkbookAttempt(null,null,body('B'),0);const keyB=h.api.workbookAttemptStorageKey();
    const b=h.api.flushWorkbookAttempts();assert.equal(h.requests.length,2);
    assert.equal(h.requests[1].body.attempts[0].clientAttemptId,'B');
    if(success)h.requests[0].resolve({results:[ack('A')]});else h.requests[0].reject(new Error('offline'));
    await a;
    assert.deepEqual(JSON.parse(h.storage.get(keyB)).map(e=>e.clientAttemptId),['B']);
    assert.equal(h.api.state.reviewData,null,'old completion must not invalidate new student Review');
    assert.equal(JSON.parse(h.storage.get(keyA)).length,success?0:1);
    h.requests[1].resolve({results:[ack('B')]});await b;
  }
});
test('each transport batch remains bounded at 20',async()=>{
  const h=harness();for(let i=0;i<21;i++)h.api.queueWorkbookAttempt(null,null,body(String(i)),0);
  const p=h.api.flushWorkbookAttempts();assert.equal(h.requests[0].body.attempts.length,20);
  h.requests[0].resolve({results:Array.from({length:20},(_,i)=>ack(String(i)))});await p;
  assert.deepEqual(Array.from(h.api.queue,e=>e.body.clientAttemptId),['20']);
});
test('Review invalidation during fetch discards stale data and refetches visible kind',async()=>{
  const h=harness();h.review.hidden=false;const p=h.api.loadReviewKind('word');
  h.api.invalidateReviewKind('word');h.requests[0].resolve({wordItems:[{id:'deleted'}],count:1});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(h.requests.length,2);
  assert.equal(h.api.state.reviewData.loaded.word,false);
  h.requests[1].resolve({wordItems:[],count:0});await p;
  assert.deepEqual(h.api.state.reviewData.wordItems,[]);assert.equal(h.api.state.reviewValidated.word,true);
  await h.api.loadReviewKind('word',{force:true});assert.equal(h.requests.length,2,'validated cached tab needs no extra request');
});
test('word removal and meaning edits invalidate an already pending Review fetch',async()=>{
  for(const change of ['remove','meaning']){
    const h=harness();h.review.hidden=false;h.api.state.savedWords=[{id:'word',lemma:'word',meaning:'old'}];
    const read=h.api.loadReviewKind('word');
    const mutation=change==='remove'?h.api.removeReviewWord('word'):h.api.updateReviewWordMeaning('word','new');
    h.requests[1].resolve({lemma:'word',meaning:'new'});await mutation;
    h.requests[0].resolve({wordItems:[{id:'word',meaning:'old'}],count:1});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(h.requests.length,3);
    const expected=change==='remove'?[]:[{id:'word',meaning:'new'}];h.requests[2].resolve({wordItems:expected,count:expected.length});await read;
    assert.deepEqual(h.api.state.reviewData.wordItems,expected);
  }
});
test('Review old-session data and 401 cannot affect the new login',async()=>{
  for(const failure of [false,true]){
    const h=harness();const p=h.api.loadReviewKind('word');h.api.clearSession();h.login('student-B-token-000000000002');
    if(failure)h.requests[0].reject(Object.assign(new Error('expired'),{status:401}));
    else h.requests[0].resolve({wordItems:[{id:'private-A'}],count:1});
    await p;assert.equal(h.api.state.reviewData,null);assert.match(h.api.state.token,/student-B/);
  }
});
test('idle prefetch and completed prefetch retain identity and catalog revision',async()=>{
  const h=harness();h.api.state.passages=[{id:'passage',has_workbook:true,canonical_revision:1}];
  h.api.prefetchWorkbooks();h.api.prefetchReview();h.api.clearSession();h.login('student-B-token-000000000002');
  h.idle.forEach(fn=>fn());assert.equal(h.requests.length,0);
  for(const switchOwner of [false,true]){
    const n=harness();n.api.state.passages=[{id:'passage',has_workbook:true,canonical_revision:1}];n.api.prefetchWorkbooks();n.idle[0]();
    if(switchOwner){n.api.clearSession();n.login('student-B-token-000000000002');}else n.api.state.passages[0].canonical_revision=2;
    n.requests[0].resolve({stages:[]});await new Promise(resolve=>setImmediate(resolve));
    assert.equal([...n.storage.keys()].some(key=>key.startsWith('ready-workbook-cache')),false);
  }
});
test('background Workbook reconciliation cannot overwrite a different stage',async()=>{
  const h=harness(),stage=(number,clears)=>({stage:number,total:5,items:[],correctClears:clears,completedCycles:0,currentCycle:1,currentCycleClears:[],progressPercent:clears*20});
  const stages=[stage(1,0),stage(2,0)];h.api.state.workbookSession={passageId:'passage',data:{stages}};
  const token=h.api.state.token;h.storage.set(`ready-workbook-cache-v3:${token}:scope:passage:0-0-`,JSON.stringify({stages}));
  // Skip mounting the cached session; this test isolates the actual response reconciliation.
  // Empty stages make startWorkbookSession return without replacing our mounted fixture.
  h.storage.set(`ready-workbook-cache-v3:${token}:scope:passage:0-0-`,JSON.stringify({stages:[]}));
  const p=h.api.openWorkbook('passage');h.requests[0].resolve({stages:[stage(1,1),stage(2,4)]});await p;
  assert.equal(stages[0].correctClears,1);assert.equal(stages[1].correctClears,4);
});
test('completed-cycle re-entry clears only transient card state and rejects late queue UI writes',async()=>{
  const h=harness(),{session,stage,first,second}=completedCycleFixture(h);
  h.api.queueWorkbookAttempt(session,first,body('prior-cycle'),7);
  h.api.chooseOtherWorkbook();
  assert.equal(session.milestone,null,'Other learning must dismiss the completed cycle.');
  assert.equal(session.orderModeSnapshot,null,'The old word-order mode must not leak into the next cycle.');
  assert.equal(session.focusedSlot,0);
  for(const item of [first,second]){
    assert.equal(item.completed,false,'The next cycle must not inherit completed cards.');
    assert.equal('lastResult' in item,false,'The prior grading result must be removed.');
    assert.equal(item.bookmarked,item===first,'Manual bookmarks must survive a visual reset.');
    assert.equal(session.responses[item.key],undefined,'Prior answers must not prefill the next cycle.');
    assert.equal(session.results[item.key],undefined,'Prior grading feedback must not reappear.');
    assert.equal(session.assistance[item.key],undefined,'Hints and live-input state must reset.');
  }
  assert.equal(session.aiPending.first,undefined);assert.equal(session.aiErrors.second,undefined);
  assert.equal(session.persistenceSequence.first,7,'The old sequence must remain to reject late persistence responses.');
  assert.equal(stage.correctClears,6);assert.equal(stage.completedCycles,3);assert.equal(stage.currentCycle,4);assert.equal(stage.progressPercent,300,'Stored progress must not be reset.');
  assert.equal(h.api.queue.length,1,'A completed-cycle reset must not discard durable submissions.');
  h.api.setWorkbookStage(0);assert.equal(session.itemIndex,0,'Re-entry must begin at a blank first card.');
  const flush=h.api.flushWorkbookAttempts();
  h.requests.at(-1).resolve({results:[{...ack('prior-cycle'),correctClears:7,completedCycles:3,currentCycle:4,currentCycleClears:['first'],progressPercent:350,bookmarked:false,reviewCount:3}]});
  await flush;
  assert.equal(session.results.first,undefined,'A late prior-cycle acknowledgement must not restore feedback.');
  assert.equal(first.bookmarked,true,'A late prior-cycle acknowledgement must not overwrite a manual bookmark.');
  assert.equal(stage.correctClears,6,'A late prior-cycle acknowledgement must not overwrite next-cycle progress.');
  assert.equal(h.api.state.reviewCount,9,'A late prior-cycle acknowledgement must not overwrite the active UI count.');
});
test('repeat starts a completed non-claim stage with the same fresh-cycle reset',async()=>{
  const h=harness(),{session,stage,first,second}=completedCycleFixture(h);
  await h.api.repeatWorkbookCycle();
  assert.equal(session.milestone,null);assert.equal(session.stageIndex,0);assert.equal(session.itemIndex,0);
  for(const item of [first,second]){assert.equal(item.completed,false);assert.equal(session.responses[item.key],undefined);assert.equal(session.results[item.key],undefined);assert.equal(session.assistance[item.key],undefined);}
  assert.equal(stage.correctClears,6);assert.equal(stage.completedCycles,3);assert.equal(session.persistenceSequence.first,7);
});
test('selecting a stage after the milestone back action also starts fresh',()=>{
  const h=harness(),{session,stage,first,second}=completedCycleFixture(h);
  h.api.setWorkbookStage(0);
  assert.equal(session.milestone,null);assert.equal(session.itemIndex,0);
  for(const item of [first,second]){assert.equal(item.completed,false);assert.equal(session.responses[item.key],undefined);assert.equal(session.results[item.key],undefined);}
  assert.equal(stage.correctClears,6);assert.equal(session.persistenceSequence.second,8);
});
test('a late writing hint cannot reappear after its completed cycle resets',async()=>{
  const h=harness(),item={key:'writing',stage:9,semanticType:'writing',slotCount:1,completed:false},stage={stage:9,semanticType:'writing',total:1,items:[item]},session={data:{stages:[stage]},passageId:'passage',stageIndex:0,itemIndex:0,responses:{},results:{},orderSelections:{},orderConsumedChips:{},orderWrongChips:{},orderBatchOrders:{},assistance:{},aiPending:{},aiErrors:{},persistenceSequence:{},milestone:null};
  h.api.state.workbookSession=session;const hint=h.api.requestWorkbookHint();
  session.results.writing={correct:true,persistenceSequence:1};item.completed=true;session.milestone={stageIndex:0,percent:100};h.api.chooseOtherWorkbook();
  h.requests[0].resolve({answer:'old answer',hintReceipt:'old',hintCount:1,visibleForMs:5000});await hint;
  assert.equal(session.assistance.writing,undefined,'A delayed hint must not recreate prior-cycle assistance state.');
  assert.equal(session.results.writing,undefined);assert.equal(item.completed,false);
});
test('changing stages during an unfinished cycle preserves that cycle state',()=>{
  const h=harness(),first={key:'first',stage:2,slotCount:1,completed:false},second={key:'second',stage:3,slotCount:1,completed:false};
  const firstStage={stage:2,total:1,items:[first]},secondStage={stage:3,total:1,items:[second]};
  const session={data:{stages:[firstStage,secondStage]},passageId:'passage',stageIndex:0,itemIndex:0,responses:{first:['in progress']},results:{},orderSelections:{},orderConsumedChips:{},orderWrongChips:{},orderBatchOrders:{},assistance:{first:{hintUsed:true}},aiPending:{},aiErrors:{},persistenceSequence:{first:4},milestone:null};
  h.api.state.workbookSession=session;h.api.setWorkbookStage(1);
  assert.deepEqual(session.responses.first,['in progress']);assert.equal(session.assistance.first.hintUsed,true);assert.equal(session.persistenceSequence.first,4);
});
let failed=0;for(const {name,run} of tests){try{await run();console.log('PASS',name);}catch(error){failed++;console.error('FAIL',name,error);}}
assert.equal(failed,0,`${failed} stability regression scenarios failed`);
