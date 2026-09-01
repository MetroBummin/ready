import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {clearReaderGlossMemory,rangesOverlap,readerGlossCacheKey,readerSentenceMarkup,resolveReaderGlossCached,validReaderGlossResult} from '../ready/reader-inline-gloss.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),read=path=>readFileSync(resolve(root,path),'utf8');
const store=new Map();globalThis.localStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
const sentence={id:'sentence-1',text:'They subscribe to the music service.'};
const phrase={resolved:true,sentenceId:sentence.id,start:5,end:17,sourceText:'subscribe to',gloss:'구독하다',lemma:'subscribe',kind:'phrase',confidence:.94};
assert(validReaderGlossResult(phrase,{sentenceId:sentence.id,text:sentence.text}),'Exact resolver range must be accepted');
assert(!validReaderGlossResult({...phrase,end:16},{sentenceId:sentence.id,text:sentence.text}),'Drifted resolver range must be rejected');
const phraseHtml=readerSentenceMarkup(sentence,[phrase]);
assert.match(phraseHtml,/구독하다[\s\S]*data-reader-gloss-reset="5:17"/,'Phrase must directly replace its exact English span');
assert.doesNotMatch(phraseHtml.replace(/<[^>]+>/g,''),/subscribe to/,'Replaced English must not remain visible');
const multiple=readerSentenceMarkup(sentence,[phrase,{resolved:true,sentenceId:sentence.id,start:22,end:27,sourceText:'music',gloss:'음악',lemma:'music',kind:'word',confidence:.98}]);
assert.match(multiple,/구독하다[\s\S]*음악/,'Non-overlapping replacements must coexist');
assert(rangesOverlap(phrase,{start:10,end:20}));assert(!rangesOverlap(phrase,{start:18,end:20}));

clearReaderGlossMemory();store.clear();const key=readerGlossCacheKey({passageId:'p',revision:'r1',sentenceId:'s',start:0,end:4,sourceText:'They'});let calls=0;
const request=()=>{calls+=1;return Promise.resolve({resolved:true,sentenceId:'s',start:0,end:4,sourceText:'They',gloss:'그들은',lemma:'they',kind:'word',confidence:.99});};
const [first,second]=await Promise.all([resolveReaderGlossCached(key,request),resolveReaderGlossCached(key,request)]);assert.equal(calls,1,'Concurrent identical lookups must deduplicate');assert.deepEqual(first,second);
clearReaderGlossMemory();const cached=await resolveReaderGlossCached(key,()=>{throw new Error('offline cache miss');});assert.equal(cached.gloss,'그들은','Local revision cache must work offline');
const nextRevision=readerGlossCacheKey({passageId:'p',revision:'r2',sentenceId:'s',start:0,end:4,sourceText:'They'});assert.notEqual(key,nextRevision,'Passage revision must invalidate cache keys');

const app=read('ready/app.js'),glossModule=read('ready/reader-inline-gloss.js'),edge=read('server/ready/index.ts'),css=read('ready/design.css');
assert.match(app,/READER_INLINE_GLOSS_ENABLED===true[\s\S]*createReaderInlineGloss/,'Reader experiment must be feature-flagged');
assert.match(app,/if\(!readerGlossEnabled\(\)\)[\s\S]*readerUnits\(\)/,'Feature-off Reader must preserve the plain prose path');
assert.doesNotMatch(glossModule,/document\.addEventListener|student-questions|student-workbook/,'Gloss events must be owned only by the Reader root');
assert.match(edge,/reader_inline_gloss[\s\S]*readerInlineGloss/,'Reader resolver operation is not dispatched');
assert.match(edge,/sentence\.slice\(start,end\)!==surfaceText/,'Server must reject client range drift');
assert.match(edge,/confidence>=0\.85[\s\S]*matches\.length===1/,'Phrase expansion must require high confidence and one exact containing span');
assert.match(css,/reader-gloss-dissolve 160ms/);assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);
console.log('READY Reader inline gloss contract verified');
