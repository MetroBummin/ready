import {readFileSync,realpathSync} from 'node:fs';
import {basename,resolve} from 'node:path';

const args=process.argv.slice(2),value=name=>{const at=args.indexOf(name);return at>=0?args[at+1]:'';},apply=args.includes('--apply'),manifestPath=value('--manifest');
if(!manifestPath)throw new Error('사용법: npm run workbook:import -- --manifest <json> [--apply]');
const manifest=JSON.parse(readFileSync(resolve(manifestPath),'utf8')),entries=Array.isArray(manifest)?manifest:manifest.entries;
if(!Array.isArray(entries)||!entries.length)throw new Error('manifest.entries에 PDF 작업을 한 개 이상 넣어 주세요.');
const apiUrl=process.env.READY_API_URL||'https://fqvhlyocdkwiyioiokte.supabase.co/functions/v1/ready',password=process.env.READY_ADMIN_PASSWORD,serviceKey=process.env.READY_IMPORT_SERVICE_KEY;
if(!password&&!serviceKey)throw new Error('READY_ADMIN_PASSWORD 또는 READY_IMPORT_SERVICE_KEY가 필요합니다.');
async function post(payload,token=''){
  const response=await fetch(apiUrl,{method:'POST',headers:{'content-type':'application/json',...(token?(serviceKey?{'x-ready-import-key':token}:{authorization:`Bearer ${token}`}):{})},body:JSON.stringify(payload)}),body=await response.json();
  if(!response.ok)throw Object.assign(new Error(body.error||`HTTP ${response.status}`),{status:response.status,detail:body.detail});
  return body;
}
const token=serviceKey||(await post({op:'admin_login',password})).session.token;
const requests=entries.map((entry,index)=>{
  const file=realpathSync(resolve(String(entry.file||''))),pdfBase64=readFileSync(file).toString('base64'),passageId=String(entry.passageId||'').trim();
  if(!passageId&&!entry.title)throw new Error(`${index+1}번: 기존 passageId 또는 새 Passage title이 필요합니다.`);
  return {op:'studio_publisher_import',pdfBase64,documentName:basename(file),sourceLocator:file,...entry,file:undefined,passageId:passageId||undefined};
});
const dryRuns=[];
for(const request of requests){
  try{const result=await post({...request,apply:false},token);dryRuns.push({request,result});console.log(JSON.stringify({phase:'dry-run',file:request.documentName,passageId:request.passageId||null,canApply:result.canApply!==false,noChange:result.noChange===true,diff:result.diff||null,inspection:result.inspection||null}));}
  catch(error){dryRuns.push({request,error});console.error(JSON.stringify({phase:'dry-run',file:request.documentName,passageId:request.passageId||null,error:error.message,detail:error.detail||null}));}
}
if(!apply){if(dryRuns.some(item=>item.error))process.exitCode=2;process.exit();}
for(const item of dryRuns){
  if(item.error||item.result?.canApply===false)continue;
  if(item.result?.noChange){console.log(JSON.stringify({phase:'apply',file:item.request.documentName,passageId:item.result.passageId,noChange:true}));continue;}
  try{const result=await post({...item.request,apply:true},token);console.log(JSON.stringify({phase:'apply',file:item.request.documentName,passageId:result.passageId,jobId:result.jobId,applied:result.applied,noChange:result.noChange===true,diff:result.diff}));}
  catch(error){console.error(JSON.stringify({phase:'apply',file:item.request.documentName,passageId:item.request.passageId||null,error:error.message,detail:error.detail||null}));process.exitCode=2;}
}
