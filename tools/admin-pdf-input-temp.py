from pathlib import Path

# The selected PDF is visibly present in the file input, but the admin flow
# only trusts FormData.get('pdf') instanceof File. That is unnecessarily brittle:
# if FormData does not expose the selected object as the current realm's File,
# the UI falls through to the "PDF 또는 본문" empty-input error.
path = Path('ready/admin/app.js')
text = path.read_text()
old = "async function startFactory(form){const data=new FormData(form),values=Object.fromEntries(data),existing=values.factoryMode==='existing_passage',pdf=data.get('pdf'),sourceText=String(data.get('sourceText')||'').trim();delete values.pdf;if(existing&&!values.existingPassageId)return toast('기존 Passage를 선택해 주세요.');if(!(pdf instanceof File)||!pdf.size){if(!existing&&!sourceText)return toast('PDF 또는 본문을 입력해 주세요.');const result=await safely(()=>call('factory_start',{...values,sourceKind:'text',sourceText},state.token,existing?'기존 Passage를 확인하는 중…':'본문을 분석하는 중…'));if(result)renderFactoryReview(result);return;}if(pdf.size>7_000_000)return toast('PDF는 7MB 이하로 올려 주세요.');const pdfBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('PDF를 읽을 수 없습니다.'));reader.onload=()=>resolve(String(reader.result||''));reader.readAsDataURL(pdf);});const result=await safely(()=>call('factory_start',{...values,sourceKind:'pdf',pdfBase64,documentName:pdf.name},state.token,'PDF를 분석하는 중…'));if(result)renderFactoryReview(result);}"
new = "function selectedFactoryPdf(form,data){const input=form.querySelector('input[type=\"file\"][accept*=\"pdf\"]'),direct=input?.files?.[0],fallback=data.get('pdf'),file=direct||fallback;return file&&typeof file==='object'&&Number(file.size)>0?file:null;}\nasync function startFactory(form){const data=new FormData(form),values=Object.fromEntries(data),existing=values.factoryMode==='existing_passage',pdf=selectedFactoryPdf(form,data),sourceText=String(data.get('sourceText')||'').trim();delete values.pdf;if(existing&&!values.existingPassageId)return toast('기존 Passage를 선택해 주세요.');if(!pdf){if(!existing&&!sourceText)return toast('PDF 또는 본문을 입력해 주세요.');const result=await safely(()=>call('factory_start',{...values,sourceKind:'text',sourceText},state.token,existing?'기존 Passage를 확인하는 중…':'본문을 분석하는 중…'));if(result)renderFactoryReview(result);return;}if(pdf.size>7_000_000)return toast('PDF는 7MB 이하로 올려 주세요.');const pdfBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('PDF를 읽을 수 없습니다.'));reader.onload=()=>resolve(String(reader.result||''));reader.readAsDataURL(pdf);});const result=await safely(()=>call('factory_start',{...values,sourceKind:'pdf',pdfBase64,documentName:pdf.name},state.token,'PDF를 분석하는 중…'));if(result)renderFactoryReview(result);}"
if old not in text:
    raise SystemExit('startFactory marker missing')
text = text.replace(old, new, 1)
path.write_text(text)

# Force browsers to fetch the corrected module after deploy instead of reusing
# an older cached app.js URL.
path = Path('ready/admin/index.html')
text = path.read_text()
old = 'app.js?v=workbook-factory-regenerate-1'
new = 'app.js?v=workbook-factory-pdf-input-1'
if old not in text:
    raise SystemExit('admin app cache-bust marker missing')
path.write_text(text.replace(old, new, 1))

# Regression coverage: the upload path must prefer the actual input.files[0],
# avoid realm-sensitive instanceof File in startFactory, and ship under a new
# module URL so the browser cannot keep stale upload code.
path = Path('tests/verify-ready-workbook-factory.mjs')
text = path.read_text()
marker = "assert.match(adminFactorySource,/finalize&&result\\.incompleteReview/,'Finalization must remain fail-closed if the server reports a changed incomplete result.');\n"
addition = marker + "assert.match(adminFactorySource,/selectedFactoryPdf[\\s\\S]*input\\?\\.files\\?\\.\\[0\\]/,'Factory PDF upload must read the file input directly before relying on FormData.');\nassert.doesNotMatch(adminFactorySource,/async function startFactory[\\s\\S]{0,800}instanceof File/,'Factory PDF upload must not reject a selected file only because instanceof File fails.');\n"
if marker not in text:
    raise SystemExit('factory admin regression marker missing')
text = text.replace(marker, addition, 1)
marker2 = "assert.match(adminHtml,/existing_passage[\\s\\S]*factory-existing-passage/,'Admin must expose the existing Passage mode and selector.');\n"
addition2 = marker2 + "assert.match(adminHtml,/app\\.js\\?v=workbook-factory-pdf-input-1/,'Admin must cache-bust the corrected PDF upload module.');\n"
if marker2 not in text:
    raise SystemExit('admin html regression marker missing')
path.write_text(text.replace(marker2, addition2, 1))
