import { readFile } from 'node:fs/promises';
import { validateQuestionSpec } from '../server/ready/question-spec.mjs';

function usage() {
  console.error('Usage: node tools/ready-import-questions.mjs <bundle.json> [--apply] [--allow-legacy]');
  process.exit(2);
}

const file=process.argv[2];
const apply=process.argv.includes('--apply');
const allowLegacy=process.argv.includes('--allow-legacy');
if(!file)usage();

const bundle=JSON.parse(await readFile(file,'utf8'));
const questions=Array.isArray(bundle)?bundle:bundle?.questions;
if(!Array.isArray(questions)||!questions.length)throw new Error('Bundle must be a non-empty JSON array.');
const written=questions.filter(item=>item?.type==='written_response');
if(written.length&&!allowLegacy){
  if(Array.isArray(bundle)||bundle?.ai_written_structure?.engine!=='codex-cli')throw new Error('Written responses must pass structure:written before import.');
  if(bundle.ai_written_structure.mode!=='full')throw new Error('A representative sample gate cannot be imported; run the full written-response gate after all samples pass.');
  const gate=bundle.ai_written_structure;
  if(Number(gate.processed_questions)!==Number(gate.source_written_questions))throw new Error('The full written-response gate did not process every source question.');
  if(Number(gate.ready)!==written.length||Number(gate.output_written_questions)!==written.length)throw new Error('Dropped written responses must not remain in the import bundle.');
  if(Number(gate.ready)+Number(gate.dropped)!==Number(gate.processed_questions))throw new Error('Written-response gate totals are inconsistent.');
}

const identities=new Set();
for(const [index,item] of questions.entries()){
  const source=item?.payload?.source||{};
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item?.passage_id||''))throw new Error(`Row ${index+1}: passage_id must be a UUID.`);
  if(!['multiple_choice','written_response'].includes(item?.type))throw new Error(`Row ${index+1}: unsupported type.`);
  if(!item?.payload?.prompt?.trim())throw new Error(`Row ${index+1}: prompt is required.`);
  if(!source.exam||!Number.isInteger(Number(source.passage_no))||!Number.isInteger(Number(source.source_question_no))||!source.section)throw new Error(`Row ${index+1}: source metadata is incomplete.`);
  const identity=[item.passage_id,source.exam,source.passage_no,source.source_question_no,source.section].join(':');
  if(identities.has(identity))throw new Error(`Row ${index+1}: duplicate source identity ${identity}.`);
  identities.add(identity);
  if(item.type==='multiple_choice'&&(!Array.isArray(item.payload.choices)||item.payload.choices.length<2||!Array.isArray(item.payload.answer)||!item.payload.answer.length))throw new Error(`Row ${index+1}: multiple-choice contract is incomplete.`);
  if(item.type==='written_response'&&(!Array.isArray(item.payload.accepted_answers)||!item.payload.accepted_answers.length))throw new Error(`Row ${index+1}: written-response accepted_answers are required.`);
  if(!item.payload.spec&&!allowLegacy)throw new Error(`Row ${index+1}: explicit payload.spec is required (use --allow-legacy only for old verified bundles).`);
  const validation=validateQuestionSpec(item.payload,item.type,item.status||'draft');
  if(validation.errors.length)throw new Error(`Row ${index+1}: invalid render spec: ${validation.errors.join(', ')}.`);
  if(validation.spec.importStatus==='ready'&&item.status!=='available')throw new Error(`Row ${index+1}: ready questions must use status=available.`);
  if(validation.spec.importStatus!=='ready'&&item.status==='available')throw new Error(`Row ${index+1}: dropped questions cannot be published.`);
}

const counts=questions.reduce((out,item)=>{const family=item.payload.family||item.type;out[family]=(out[family]||0)+1;return out;},{});
console.log(JSON.stringify({valid:true,questions:questions.length,families:counts,mode:apply?'apply':'dry-run'},null,2));
if(!apply)process.exit(0);

const apiUrl=process.env.READY_API_URL;
const password=process.env.READY_ADMIN_PASSWORD;
if(!apiUrl||!password)throw new Error('READY_API_URL and READY_ADMIN_PASSWORD are required for --apply.');

async function post(body,token=''){
  const response=await fetch(apiUrl,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`READY API ${response.status}`);
  return data;
}

const login=await post({op:'admin_login',password});
try{
  const result=await post({op:'import_questions',questions},login.session.token);
  console.log(JSON.stringify(result,null,2));
}finally{
  await post({op:'logout'},login.session.token).catch(()=>{});
}
