// READY — fixed Scope > Passage Reader
// Custom opaque sessions are validated here. Deploy this Edge Function with JWT verification disabled.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { bearerToken, randomSessionToken, secureEqual, sha256Hex } from "./auth-core.mjs";
import { lemma, tokenizeSentence } from "./lexical-core.mjs";
import { NE_MINBYEONGCHEON_L1_WORKBOOK } from "./workbook-ne-l1.mjs";
import { NE_MINBYEONGCHEON_L2_WORKBOOK } from "./workbook-ne-l2.mjs";
import { YBM_PARKJUNEON_L1_WORKBOOK } from "./workbook-ybm-l1.mjs";
import { YBM_PARKJUNEON_L2_WORKBOOK } from "./workbook-ybm-l2.mjs";
import { DONGA_LEEBYEONGMIN_L4_WORKBOOK } from "./workbook-donga-l4.mjs";
import { validateQuestionSpec } from "./question-spec.mjs";
import { deterministicClientContract, deterministicGrade, publicInteractionContract } from "./interaction-contract.mjs";
import { WORKBOOK_TRANSLATION_GRADING_POLICY, workbookTranslationPass } from "./workbook-grading-policy.mjs";
import { normalizeWorkbookAnswer, publicWorkbookAssistance, stageNineHint, workbookAssistanceMode } from "./workbook-assistance.mjs";
import { CURRENT_QUESTION_PUBLICATION_VERSION } from "./question-pipeline.mjs";
import { extractSentenceRows, generateWorkbookCatalog, inspectFullWorkbookText } from "./workbook-factory.mjs";
import { extractUnicodePdfText } from "./pdf-text-extract.mjs";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
function supabaseAdminKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const key = keys?.ready_secret_key || keys?.default;
    if (typeof key === "string" && key) return key;
  } catch { /* fallback below */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", supabaseAdminKey(), { auth: { persistSession: false } });
const adminOps = new Set(["teacher_bootstrap", "delete_impact", "assign_scope_passages", "set_scope_passages", "create_passage", "update_passage", "delete_passage", "create_student", "set_student_code", "delete_student", "import_questions", "import_explanations", "factory_start", "factory_confirm"]);
const studentOps = new Set(["student_bootstrap", "student_passage", "word_lookup_meaning", "save_reader_word", "remove_reader_word", "update_reader_word_meaning", "sentence_easy_translation", "sentence_structure", "student_questions", "student_question_filters", "student_question_queue", "student_review_questions", "set_question_bookmark", "submit_attempt", "student_workbook", "workbook_assistance", "set_workbook_bookmark", "workbook_hint", "submit_workbook_attempt"]);
const publicOps = new Set(["student_login", "admin_login"]);
// Match Breeze's free Gemini dictionary defaults. The API key remains a
// Supabase Edge Function Secret and is never part of any public response.
const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash-lite";
const AI_DAILY_LIMIT = Math.max(1, Math.min(1_000, Number(Deno.env.get("AI_DAILY_LIMIT") ?? 100)));
const AI_GRADING_DAILY_LIMIT = Math.max(1, Math.min(1_000, Number(Deno.env.get("AI_GRADING_DAILY_LIMIT") ?? 100)));
const GEMINI_SYSTEM = "You are a precise bilingual dictionary for Korean learners reading English books. Reply with ONLY minified JSON. No markdown, no code fence, no commentary.";
const GEMINI_GRADING_SYSTEM = "You grade Korean secondary-school English answers against a publisher-verified semantic reference. Do not invent a new answer key. Accept faithful synonyms and paraphrases unless the supplied rubric explicitly requires exact words, forms, or word counts. Required grammar, conditions, slot boundaries, and required word counts remain strict. Reply with ONLY minified JSON.";

type ReadySession = { id: string; actor_type: "student" | "admin"; student_id: string | null; remembered: boolean; expires_at: string };
type Student = { id: string; name: string; school: string; grade: string };
class ApiError extends Error { constructor(public status: number, message: string, public detail?: unknown) { super(message); } }
function clean(value: unknown, max = 10_000) { return String(value ?? "").replace(/\u0000|[\uD800-\uDFFF]/g, "").trim().slice(0, max); }
function required(value: unknown, name: string, max = 10_000) { const out = clean(value, max); if (!out) throw new ApiError(400, `${name} 값이 필요합니다.`); return out; }
function rows<T>(result: { data: T | null; error: { message: string } | null }): T { if (result.error) throw new ApiError(500, result.error.message); return result.data as T; }
function cleanList(value: unknown, count: number, max: number) { return (Array.isArray(value) ? value : []).map(item => clean(item, max)).filter(Boolean).slice(0, count); }
function parseJson(raw: string) { try { return JSON.parse(raw); } catch { /* Gemini occasionally adds a wrapper despite JSON mode. */ } const found = raw.match(/\{[\s\S]*\}/); if (!found) return null; try { return JSON.parse(found[0]); } catch { return null; } }
function geminiModels() {
  const configured = clean(Deno.env.get("GEMINI_MODEL"), 80), fallback = clean(Deno.env.get("GEMINI_FALLBACK_MODEL"), 80) || GEMINI_FALLBACK_MODEL;
  return [...new Set([configured || GEMINI_MODEL, fallback].filter(Boolean))];
}

type ReaderGlossPromptContext = { clicked:string; lemma:string; sentence:string; translation:string; savedMeaning:string; previousMeaning:string; retry:boolean };
function geminiInlineGlossPrompt(context: ReaderGlossPromptContext) {
  return `한국 중고등학생이 영어 단어 또는 하나의 고정 표현을 기억하도록 돕는 사전형 뜻을 만드세요.

클릭한 표면형: ${context.clicked}
Breeze lexical core lemma: ${context.lemma}
현재 영어 문장: ${context.sentence}
현재 출판사 한국어 문장: ${context.translation||"(없음)"}
현재 저장된 뜻: ${context.savedMeaning||"(없음)"}
${context.retry?`직전 후보 뜻: ${context.previousMeaning||"(없음)"}\n학생이 표시된 뜻을 다시 눌렀습니다. 현재 문맥에서 가능한 다른 짧은 사전형 뜻이 있으면 제시하고, 직전 뜻이 가장 정확하면 그대로 유지하세요.`:"첫 조회입니다."}

핵심 원칙:
- 이것은 문장 번역 기능이 아닙니다. 학생이 클릭한 단어 또는 실제 고정 표현 자체를 기억할 수 있는 짧은 한국어 뜻 하나만 반환합니다.
- 현재 문장과 출판사 한국어는 품사와 다의어의 sense를 결정하는 참고 자료일 뿐입니다. 주어, 목적어, 일반 수식어를 meaning에 붙이지 마세요.
- source_span은 기본적으로 clicked token 하나입니다.
- 구동사, 숙어, 고정 결합처럼 전체가 하나의 lexical expression일 때만 kind를 phrase로 하고 source_span을 최소 범위로 확장합니다.
- 일반적인 verb + object, adjective + noun, verb + ordinary modifier는 phrase가 아닙니다.
${context.retry?`- 현재 저장된 뜻은 빠른 첫 표시를 위한 weak hint일 뿐이며 현재 문맥의 정답으로 간주하지 마세요.
- 현재 영어 문장과 출판사 한국어를 우선하여 sense를 독립적으로 다시 판단하세요.
- 저장된 뜻이 현재 문맥에도 적합하면 그대로 반환하고, 다른 sense이면 더 적절한 짧은 사전형 뜻을 반환하세요.`:""}

명확한 예시:
discovering new songs / clicked: discovering
GOOD {"lemma":"discover","meaning":"발견하다","source_span":"discovering","kind":"word","confidence":0.97}
BAD meaning: "새로운 노래를 발견하다"

by subscribing to the service / clicked: subscribing
GOOD {"lemma":"subscribe","meaning":"구독하다","source_span":"subscribing","kind":"word","confidence":0.97}
BAD meaning: "서비스를 구독함으로써"

carefully collect all the evidence / clicked: collect
GOOD {"lemma":"collect","meaning":"수집하다","source_span":"collect","kind":"word","confidence":0.97}
BAD meaning: "모든 증거를 주의 깊게 수집하다"

take part in the project / clicked: part
GOOD {"lemma":"part","meaning":"참여하다","source_span":"take part in","kind":"phrase","confidence":0.96}

필드:
- lemma: 제공된 Breeze lemma를 우선 사용합니다.
- meaning: 2~18자 내외의 기억하기 좋은 한국어 사전형 뜻 하나. 설명문 금지.
- source_span: 현재 영어 문장에 글자 그대로 한 번 존재하고 clicked token을 포함하는 최소 span.
- kind: word 또는 phrase.
- confidence: 0부터 1. sense나 span이 불확실하면 0.65 미만.

{"lemma":"","meaning":"","source_span":"","kind":"word","confidence":0}`;
}
async function callGeminiInlineGloss(context: ReaderGlossPromptContext) {
  const provider=(Deno.env.get("AI_PROVIDER")??"").trim().toLowerCase(),key=Deno.env.get("GEMINI_API_KEY");
  if(provider!=="gemini"||!key)throw new ApiError(503,"Gemini 문맥 뜻풀이가 아직 연결되지 않았습니다.");
  const base={maxOutputTokens:180,temperature:0.1,responseMimeType:"application/json"};let lastError="",lastStatus=0;
  for(const model of geminiModels())for(const generationConfig of [{...base,thinkingConfig:{thinkingBudget:0}},base]){
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({system_instruction:{parts:[{text:GEMINI_SYSTEM}]},contents:[{role:"user",parts:[{text:geminiInlineGlossPrompt(context)}]}],generationConfig})});
    if(response.ok){const payload=await response.json(),text=(payload?.candidates?.[0]?.content?.parts||[]).map((part:{text?:string})=>part?.text||"").join("").trim(),parsed=parseJson(text);if(parsed)return parsed;throw new ApiError(502,"Gemini 문맥 뜻풀이를 읽지 못했습니다.");}
    lastStatus=response.status;lastError=(await response.text()).slice(0,300);if(response.status===400)continue;if(response.status===429)break;throw new ApiError(502,"Gemini 문맥 뜻풀이를 잠시 사용할 수 없습니다.");
  }
  console.error("READY Gemini inline gloss failed:",lastStatus,lastError);throw new ApiError(lastStatus===429?429:502,lastStatus===429?"Gemini 단어 뜻 조회 한도를 모두 사용했습니다.":"Gemini 문맥 뜻풀이를 잠시 사용할 수 없습니다.");
}

function aiGradingPrompt(question: any, spec: any, responses: string[]) {
  const payload = question.payload || {}, guide = spec.writingGuide || {}, accepted = Array.isArray(payload.accepted_answers) ? payload.accepted_answers : [];
  const referenceAnswers = accepted.map((slot: unknown) => (Array.isArray(slot) ? slot : [slot]).map(value => clean(value, 2_000)));
  return `다음 학생 답안을 출판사 정답표에서 온 reference_answers에만 근거해 채점하세요.

문제: ${clean(spec.prompt, 1_000)}
영작/해석 대상: ${clean(guide.taskText, 2_000)}
조건: ${JSON.stringify(guide.conditions || [])}
필수 단어/표현: ${JSON.stringify(guide.wordBank || [])}
답칸 명세: ${JSON.stringify(spec.responseSlots || [])}
reference_answers: ${JSON.stringify(referenceAnswers)}
student_responses: ${JSON.stringify(responses)}

판정 원칙:
- 단순 대소문자, 문장부호, 앞뒤 공백 차이는 무시합니다.
- reference_answers는 의미의 source of truth이지 암기해야 하는 고정 문자열이 아닙니다.
- 문제 조건이 특정 어휘·어형·단어 수를 요구하지 않으면 같은 원인·사실을 나타내는 자연스러운 동의어와 바꿔쓰기를 정답으로 인정합니다.
- 정답 의미에 필수적이지 않은 수식어가 생략되어도 핵심 사실과 인과관계가 보존되면 오답으로 만들지 않습니다.
- 해석 문제에서는 정도·강조 수식어가 빠져도 핵심 명사와 서술 관계가 같으면 정답으로 인정합니다. 예: reference가 "아주 작은"이고 학생이 "작은"이라고 써도 맞습니다.
- 번역투, 어순, 존댓말, 조사 선택의 작은 차이보다 핵심 의미 전달을 우선합니다. 반대 의미, 핵심 대상·행동·인과의 누락만 오답으로 봅니다.
- 의미만 비슷하고 문제의 문법/어형/단어 수/제시어 조건을 어기면 오답입니다.
- 복수 답칸은 각 답칸의 경계를 바꾸거나 합치지 않습니다.
- reference_answers의 의미를 벗어난 새로운 해석을 만들지 않습니다.
- short_feedback은 학생이 바로 고칠 수 있는 한국어 한 문장, 최대 80자입니다.

{"correct":false,"score":0,"short_feedback":"","error_tags":[""]}`;
}

async function callGeminiGrade(question: any, spec: any, responses: string[]) {
  const provider = (Deno.env.get("AI_PROVIDER") ?? "").trim().toLowerCase(), key = Deno.env.get("GEMINI_API_KEY");
  if (provider !== "gemini" || !key) throw new ApiError(503, "AI 채점이 아직 연결되지 않았습니다.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const base = { maxOutputTokens: 500, temperature: 0, responseMimeType: "application/json" }, configs = [{ ...base, thinkingConfig: { thinkingBudget: 0 } }, base];
  let lastError = "";
  for (const generationConfig of configs) {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system_instruction: { parts: [{ text: GEMINI_GRADING_SYSTEM }] }, contents: [{ role: "user", parts: [{ text: aiGradingPrompt(question, spec, responses) }] }], generationConfig }) });
    if (response.ok) {
      const payload = await response.json(), answerText = (payload?.candidates?.[0]?.content?.parts || []).map((part: { text?: string }) => part?.text || "").join("").trim(), parsed = parseJson(answerText);
      if (!parsed || typeof parsed.correct !== "boolean" || !Number.isFinite(Number(parsed.score))) throw new ApiError(502, "AI 채점 결과 형식이 올바르지 않습니다.");
      return { correct: parsed.correct === true, score: Math.max(0, Math.min(100, Math.round(Number(parsed.score)))), shortFeedback: clean(parsed.short_feedback, 160), errorTags: cleanList(parsed.error_tags, 8, 40) };
    }
    lastError = (await response.text()).slice(0, 300);
    if (response.status !== 400) break;
  }
  console.error("READY AI grading failed:", lastError);
  throw new ApiError(502, "AI 채점을 잠시 사용할 수 없습니다. 잠시 후 다시 제출해 주세요.");
}

function workbookTranslationPrompt(item: any, response: string) {
  return `다음 워크북 번역 답안을 출판사 원문과 출판사 해석에만 근거해 100점 만점으로 평가하세요.

영문 원문: ${clean(item.source, 2_000)}
출판사 해석: ${clean(item.answers?.[0], 2_000)}
학생 해석: ${clean(response, 2_000)}
채점 정책: ${WORKBOOK_TRANSLATION_GRADING_POLICY.version}
배점: 핵심 의미 60점, 주체·행동·대상·부정·인과 등 핵심 관계 30점, 자연스러운 한국어 10점

원칙:
- 출판사 해석은 의미의 기준이며 외워야 하는 고정 문자열이 아닙니다.
- 동의어, 자연스러운 의역, 어순·조사·존댓말 차이는 의미가 같으면 감점하지 않습니다.
- 정도 부사의 작은 생략은 핵심 의미를 바꾸지 않으면 경미하게만 봅니다. 예: "아주 작은"을 "작은"으로 쓴 경우.
- critical_errors에는 주체·행동·대상·부정·수치·인과를 뒤집거나 핵심 절을 빠뜨린 중대한 오류만 넣습니다.
- feedback_lines는 학생이 바로 고칠 수 있는 한국어 문장 1~3개입니다.
- 틀린 부분이 있으면 "의미를 잘 파악하지 못했습니다"처럼 뭉뚱그리지 말고, 형용사절·부사절·주절의 동사·주어/목적어·부정·인과 중 실제로 잘못 해석한 단위를 정확히 지목하세요.
- 통과 답안도 단순 칭찬만 하지 말고, 정확히 보존된 핵심 절이나 관계를 한 가지 짚으세요.
- 문법 용어만 나열하지 말고 학생 답안의 어떤 표현을 어떻게 고치면 되는지 짧게 설명하세요.
- 정답/오답 boolean은 반환하지 마세요. 통과 여부는 서버가 점수와 critical_errors로 결정합니다.

{"score":0,"critical_errors":[],"feedback_lines":[""],"error_tags":[]}`;
}

async function callGeminiTranslationGrade(item: any, response: string) {
  const provider = (Deno.env.get("AI_PROVIDER") ?? "").trim().toLowerCase(), key = Deno.env.get("GEMINI_API_KEY");
  if (provider !== "gemini" || !key) throw new ApiError(503, "AI 채점이 아직 연결되지 않았습니다.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const base = { maxOutputTokens: 650, temperature: 0, responseMimeType: "application/json" }, configs = [{ ...base, thinkingConfig: { thinkingBudget: 0 } }, base];
  let lastError = "";
  for (const generationConfig of configs) {
    const responseResult = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system_instruction: { parts: [{ text: GEMINI_GRADING_SYSTEM }] }, contents: [{ role: "user", parts: [{ text: workbookTranslationPrompt(item, response) }] }], generationConfig }) });
    if (responseResult.ok) {
      const payload = await responseResult.json(), answerText = (payload?.candidates?.[0]?.content?.parts || []).map((part: { text?: string }) => part?.text || "").join("").trim(), parsed = parseJson(answerText);
      if (!parsed || !Number.isFinite(Number(parsed.score)) || !Array.isArray(parsed.critical_errors) || !Array.isArray(parsed.feedback_lines) || !Array.isArray(parsed.error_tags)) throw new ApiError(502, "AI 번역 채점 결과 형식이 올바르지 않습니다.");
      const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
      const criticalErrors = cleanList(parsed.critical_errors, 8, 160), feedbackLines = cleanList(parsed.feedback_lines, 3, 160), errorTags = cleanList(parsed.error_tags, 8, 40);
      if (!feedbackLines.length) feedbackLines.push(score >= WORKBOOK_TRANSLATION_GRADING_POLICY.passScore && !criticalErrors.length ? "핵심 의미를 잘 전달했습니다." : "핵심 의미와 문장 관계를 다시 확인해 보세요.");
      return { score, criticalErrors, feedbackLines, errorTags };
    }
    lastError = (await responseResult.text()).slice(0, 300);
    if (responseResult.status !== 400) break;
  }
  console.error("READY workbook translation grading failed:", lastError);
  throw new ApiError(502, "AI 번역 채점을 잠시 사용할 수 없습니다. 잠시 후 다시 제출해 주세요.");
}

async function studentForSession(session: ReadySession): Promise<Student> {
  const result = await db.from("ready_students").select("id,name,school,grade").eq("id", session.student_id).eq("active", true).maybeSingle();
  if (result.error) throw new ApiError(500, result.error.message);
  if (!result.data) {
    await db.from("ready_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", session.id);
    throw new ApiError(401, "사용할 수 없는 학생 계정입니다.");
  }
  return result.data as Student;
}
async function authenticate(req: Request, actor?: "student" | "admin"): Promise<ReadySession> {
  const token = bearerToken(req.headers.get("authorization"));
  if (!token) throw new ApiError(401, "로그인이 필요합니다.");
  const tokenHash = await sha256Hex(token);
  const result = await db.from("ready_sessions").select("id,actor_type,student_id,remembered,expires_at").eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (result.error) throw new ApiError(500, result.error.message);
  if (!result.data || (actor && result.data.actor_type !== actor)) throw new ApiError(401, "세션이 만료되었거나 권한이 없습니다.");
  const session = result.data as ReadySession;
  await db.from("ready_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", session.id);
  return session;
}
async function createSession(actorType: "student" | "admin", studentId: string | null, remember = false) {
  const token = randomSessionToken(), tokenHash = await sha256Hex(token);
  const hours = actorType === "admin" ? 8 : (remember ? 24 * 30 : 12);
  const expiresAt = new Date(Date.now() + hours * 3_600_000).toISOString();
  const result = await db.from("ready_sessions").insert({ token_hash: tokenHash, actor_type: actorType, student_id: studentId, remembered: actorType === "student" && remember, expires_at: expiresAt });
  if (result.error) throw new ApiError(500, result.error.message);
  return { token, expiresAt, remember: actorType === "student" && remember };
}
async function assertLoginAllowed(identifier: string) {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const result = await db.from("ready_login_attempts").select("id", { count: "exact", head: true }).eq("identifier", identifier).eq("successful", false).gte("created_at", cutoff);
  if (result.error) throw new ApiError(500, result.error.message);
  if ((result.count || 0) >= 5) throw new ApiError(429, "로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요.");
}
async function recordLogin(identifier: string, successful: boolean) { const result = await db.from("ready_login_attempts").insert({ identifier, successful }); if (result.error) console.error("ready_login_attempts:", result.error.message); }
async function revokeSession(session: ReadySession) { const result = await db.from("ready_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", session.id); if (result.error) throw new ApiError(500, result.error.message); return { loggedOut: true }; }

function validStudentCode(value:string){return /^\d{6}$/.test(value);}
async function studentCodeFingerprint(code:string){
  const pepper=Deno.env.get("READY_STUDENT_CODE_PEPPER")||supabaseAdminKey();
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(`${pepper}:ready-student-code-v1`),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(code));
  return [...new Uint8Array(signature)].map(value=>value.toString(16).padStart(2,"0")).join("");
}
function codeRpcError(error:{message:string}|null){if(!error)return;if(/이미 사용 중인 학생 코드|unique/i.test(error.message))throw new ApiError(409,"이미 사용 중인 학생 코드입니다.");throw new ApiError(500,error.message);}
async function studentLogin(body: any) {
  const code=clean(body.code,10);if(!validStudentCode(code))throw new ApiError(400,"학생 코드는 숫자 6자리입니다.");
  const fingerprint=await studentCodeFingerprint(code),identifier=`student-code:${fingerprint.slice(0,16)}`;await assertLoginAllowed(identifier);
  const verified=await db.rpc("ready_verify_student_code",{p_code_fingerprint:fingerprint,p_code:code});
  if(verified.error)throw new ApiError(500,verified.error.message);
  const studentId=clean(verified.data,80),ok=!!studentId;await recordLogin(identifier,ok);if(!ok)throw new ApiError(401,"학생 코드를 확인해 주세요.");
  const student = rows<any>(await db.from("ready_students").select("id,name,school,grade").eq("id", studentId).eq("active", true).single());
  return { session: await createSession("student", student.id, body.remember === true), student };
}
async function adminLogin(body: any) {
  const expected = Deno.env.get("READY_ADMIN_PASSWORD") || ""; if (!expected) throw new ApiError(503, "READY_ADMIN_PASSWORD가 서버에 설정되지 않았습니다.");
  await assertLoginAllowed("admin"); const supplied = String(body.password ?? "").slice(0, 200), ok = supplied.length > 0 && secureEqual(supplied, expected);
  await recordLogin("admin", ok); if (!ok) throw new ApiError(401, "관리자 비밀번호가 맞지 않습니다.");
  return { session: await createSession("admin", null, false) };
}
async function createStudent(body: any) {
  const name=required(body.name,"학생 이름",40),school=required(body.school,"학교",80),grade=required(body.grade,"학년",40),code=clean(body.code,10);
  if(!validStudentCode(code))throw new ApiError(400,"학생 코드는 숫자 6자리여야 합니다.");
  const result=await db.rpc("ready_create_student_with_code",{p_name:name,p_school:school,p_grade:grade,p_code:code,p_code_fingerprint:await studentCodeFingerprint(code),p_sort_order:0});
  codeRpcError(result.error);
  return { student: rows<any[]>(result)[0] };
}
async function setStudentCode(body:any){const studentId=required(body.studentId,"학생",80),code=clean(body.code,10);if(!validStudentCode(code))throw new ApiError(400,"학생 코드는 숫자 6자리여야 합니다.");const result=await db.rpc("ready_set_student_code",{p_student_id:studentId,p_code:code,p_code_fingerprint:await studentCodeFingerprint(code)});codeRpcError(result.error);return {updated:studentId};}
async function countWhere(table: string, column: string, value: string) {
  const result = await db.from(table).select("*", { count: "exact", head: true }).eq(column, value);
  if (result.error) throw new ApiError(500, result.error.message);
  return result.count || 0;
}
async function deleteImpact(body: any) {
  const targetType = clean(body.targetType, 20), targetId = required(body.targetId, "삭제 대상", 80);
  if (targetType === "student") {
    const student = await db.from("ready_students").select("id,name").eq("id", targetId).maybeSingle();
    if (student.error) throw new ApiError(500, student.error.message); if (!student.data) throw new ApiError(404, "학생을 찾지 못했습니다.");
    const [attempts, savedWords, savedSentences, wordLookups, translationViews] = await Promise.all([
      countWhere("ready_attempts", "student_id", targetId), countWhere("ready_saved_words", "student_id", targetId),
      countWhere("ready_saved_sentences", "student_id", targetId), countWhere("ready_word_lookup_events", "student_id", targetId),
      countWhere("ready_sentence_translation_view_events", "student_id", targetId),
    ]);
    const counts = { attempts, savedWords, savedSentences, wordLookups, translationViews };
    return { targetType, targetId, label: student.data.name, counts };
  }
  if (targetType === "passage") {
    const passage = await db.from("ready_passages").select("id,title").eq("id", targetId).maybeSingle();
    if (passage.error) throw new ApiError(500, passage.error.message); if (!passage.data) throw new ApiError(404, "지문을 찾지 못했습니다.");
    const questions = rows<any[]>(await db.from("ready_questions").select("id").eq("passage_id", targetId)), questionIds = questions.map(item => item.id);
    const attempts = questionIds.length ? rows<any[]>(await db.from("ready_attempts").select("id").in("question_id", questionIds)).length : 0;
    const [sentences, examLinks, savedWords, savedSentences, wordLookups, translationViews] = await Promise.all([
      countWhere("ready_passage_sentences", "passage_id", targetId),countWhere("ready_exam_passages", "passage_id", targetId),
      countWhere("ready_saved_words", "passage_id", targetId), countWhere("ready_saved_sentences", "passage_id", targetId),
      countWhere("ready_word_lookup_events", "passage_id", targetId), countWhere("ready_sentence_translation_view_events", "passage_id", targetId),
    ]);
    const counts = { sentences, questions: questions.length, examLinks, attempts, savedWords, savedSentences, wordLookups, translationViews };
    return { targetType, targetId, label: passage.data.title, counts };
  }
  throw new ApiError(400, "삭제 대상 종류가 올바르지 않습니다.");
}
async function deleteStudent(body: any) {
  const studentId = required(body.studentId, "학생", 80), result = await db.rpc("ready_delete_student_cascade", { p_student_id: studentId });
  if (result.error) throw new ApiError(500, result.error.message); return { deleted: studentId };
}

async function teacherBootstrap() {
  const [students, exams, passages, examPassages] = await Promise.all([
    db.from("ready_students").select("id,name,school,grade,created_at").order("school").order("grade").order("name"), db.from("ready_exams").select("id,school,grade,title,is_current").eq("is_current", true).order("school").order("grade"), db.from("ready_passages").select("id,title,source_type,grade,source_year,source_month,source_label,created_at,updated_at").order("display_order").order("created_at"), db.from("ready_exam_passages").select("exam_id,passage_id,position").order("position"),
  ]);
  return { students: rows(students), exams: rows(exams), passages: rows(passages), examPassages: rows(examPassages) };
}
function ids(value: unknown) { return Array.isArray(value) ? [...new Set(value.map(item => clean(item, 80)).filter(Boolean))] : []; }
async function setScopePassages(body: any, replace: boolean) {
  const passageIds = ids(body.passageIds), school = required(body.school, "학교", 80), grade = required(body.grade, "학년", 40);
  if (!replace && !passageIds.length) throw new ApiError(400, "배정할 지문을 하나 이상 선택해 주세요.");
  const result = await db.rpc("ready_set_current_scope_passages", { p_school: school, p_grade: grade, p_passage_ids: passageIds, p_replace: replace });
  if (result.error) throw new ApiError(400, result.error.message);
  const relink = await db.rpc("ready_relink_ne_minbyeongcheon_lessons");
  if (relink.error) throw new ApiError(500, relink.error.message);
  return { scopeId: result.data as string };
}
async function createPassage(body: any) {
  if (!Array.isArray(body.sentenceRows)) throw new ApiError(400, "영어와 한국어 2열 rows가 필요합니다.");
  if (body.sentenceRows.length < 1 || body.sentenceRows.length > 80) throw new ApiError(400, "한 지문은 1~80행이어야 합니다.");
  const structuredRows = body.sentenceRows.map((row: any, index: number) => {
    const text = clean(row?.text, 5001), translation = clean(row?.translation, 5001);
    if (!text) throw new ApiError(400, `${index + 1}번 행의 영어 문장이 비어 있습니다.`);
    if (!translation) throw new ApiError(400, `${index + 1}번 행의 한국어 해석이 비어 있습니다.`);
    if (text.length > 5000 || translation.length > 5000) throw new ApiError(400, `${index + 1}번 행이 너무 깁니다.`);
    return { text, translation };
  });
  const sourceType = body.sourceType === "MOCK_EXAM" ? "MOCK_EXAM" : "TEXTBOOK", title = required(body.title, "지문 제목", 120), grade = required(body.grade, "학년", 40), sourceYear = body.sourceYear ? Math.round(Number(body.sourceYear)) : null, sourceMonth = body.sourceMonth ? Math.round(Number(body.sourceMonth)) : null;
  if (sourceType === "MOCK_EXAM" && (!sourceYear || !sourceMonth)) throw new ApiError(400, "모의고사는 연도와 월이 필요합니다.");
  const passageId = rows<string>(await db.rpc("ready_create_passage_with_sentences", { p_title: title, p_source_type: sourceType, p_grade: grade, p_source_year: sourceYear, p_source_month: sourceMonth, p_source_label: clean(body.sourceLabel, 120), p_rows: structuredRows }));
  return { passageId };
}
function factoryRows(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 80) throw new ApiError(400, "문장쌍은 1~80행이어야 합니다.");
  return value.map((row: any, index: number) => {
    const text = clean(row?.text, 5001), translation = clean(row?.translation, 5001);
    if (!text || !translation) throw new ApiError(400, `${index + 1}번 행의 영어 문장과 한국어 해석을 모두 확인해 주세요.`);
    return { text, translation };
  });
}
async function factoryGemini(prompt: string, maxOutputTokens: number) {
  const provider = (Deno.env.get("AI_PROVIDER") ?? "").trim().toLowerCase(), key = Deno.env.get("GEMINI_API_KEY");
  if (provider !== "gemini" || !key) throw new ApiError(503, "Workbook Factory Gemini가 아직 연결되지 않았습니다.");
  const base = { maxOutputTokens: Math.min(8_192, Math.max(256, maxOutputTokens)), temperature: 0.1, responseMimeType: "application/json" }, configs = [{ ...base, thinkingConfig: { thinkingBudget: 0 } }, base];
  let lastStatus = 0, lastError = "";
  for (const model of geminiModels()) for (const generationConfig of configs) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system_instruction: { parts: [{ text: "You create structured, source-grounded English workbook data. Return only JSON. Never invent or alter a canonical sentence." }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig }) });
    if (response.ok) { const payload = await response.json(), parsed = parseJson((payload?.candidates?.[0]?.content?.parts || []).map((part: any) => part?.text || "").join("")); if (!parsed) throw new ApiError(502, "Workbook Factory Gemini 결과 형식이 올바르지 않습니다."); return { parsed, tokenUsage: Number(payload?.usageMetadata?.totalTokenCount) || 0 }; }
    lastStatus = response.status; lastError = (await response.text()).slice(0, 300); if (response.status === 400) continue; if (response.status === 429) break; throw new ApiError(502, `Workbook Factory Gemini 요청이 실패했습니다 (${response.status}).`);
  }
  console.error("READY Workbook Factory Gemini failed:", lastStatus, lastError);
  throw new ApiError(502, `Workbook Factory Gemini 요청이 실패했습니다 (${lastStatus || "network"}).`);
}
async function factoryTranslate(rows: any[]) {
  const result = await factoryGemini(`Translate each canonical English sentence into natural Korean. Preserve order; do not add meaning. Return {"translations":["..."]} with exactly ${rows.length} entries.\n${JSON.stringify(rows.map(row => row.text))}`, Math.min(8_192, 120 * rows.length + 400));
  const translations = Array.isArray(result.parsed?.translations) ? result.parsed.translations.map((value: unknown) => clean(value, 5000)) : [];
  if (translations.length !== rows.length || translations.some((value: string) => !value)) throw new ApiError(502, "문장별 한국어 해석을 검증하지 못했습니다.");
  return { rows: rows.map((row, index) => ({ ...row, translation: translations[index] })), tokenUsage: result.tokenUsage };
}
async function factoryExercises(rows: any[], requestedStages = [5, 6, 7]) {
  const source = rows.map((row, index) => ({ sentenceIndex: index + 1, text: row.text, translation: row.translation }));
  const stages = requestedStages.filter((stage: number) => [5, 6, 7].includes(stage));
  if (!stages.length) return { stages: { 5: [], 6: [], 7: [] }, tokenUsage: 0, callCount: 0 };
  const prompt = `Create only source-grounded exercises for these canonical sentence pairs. Return JSON object keys only for requested READY stages ${JSON.stringify(stages)}. Stage 5 item fields: sentenceIndex, prompt, hint, answer. prompt must equal canonical English with the exact answer replaced by 12 underscores; hint is the base verb. Stage 6 fields: sentenceIndex, prompt, wrong, answer. prompt must equal canonical English with answer replaced by 12 underscores. Stage 7 fields: sentenceIndex, sentence, wrong, correct. sentence must equal canonical English with one exact correct substring replaced by wrong. Use no more than one item per sentence and omit if unsure. Never create a new canonical answer.\n${JSON.stringify(source)}`;
  const result = await factoryGemini(prompt, Math.min(8_192, 170 * rows.length + 700));
  return { stages: { 5: Array.isArray(result.parsed?.[5]) ? result.parsed[5] : [], 6: Array.isArray(result.parsed?.[6]) ? result.parsed[6] : [], 7: Array.isArray(result.parsed?.[7]) ? result.parsed[7] : [] }, tokenUsage: result.tokenUsage, callCount: 1 };
}
async function finalizeFactoryJob(job: any, confirmedRows?: unknown) {
  const rowsForCatalog = factoryRows(confirmedRows ?? job.extracted_rows);
  const metadata = job.source_metadata || {}, sourceType = metadata.sourceType === "MOCK_EXAM" ? "MOCK_EXAM" : "TEXTBOOK", title = required(job.title, "지문 제목", 120), grade = required(metadata.grade, "학년", 40), sourceYear = metadata.sourceYear ? Math.round(Number(metadata.sourceYear)) : null, sourceMonth = metadata.sourceMonth ? Math.round(Number(metadata.sourceMonth)) : null;
  if (sourceType === "MOCK_EXAM" && (!sourceYear || !sourceMonth)) throw new ApiError(400, "모의고사는 연도와 월이 필요합니다.");
  const sourceExercises = Array.isArray(job.extraction?.sourceExercises) ? job.extraction.sourceExercises : [], fullWorkbook = job.extraction?.fullWorkbook === true;
  const executableTypes = new Set(sourceExercises.filter((exercise: any) => clean(exercise?.answer, 300) || (Array.isArray(exercise?.answers) && exercise.answers.length)).map((exercise: any) => clean(exercise?.type, 80)));
  const incompleteStages = new Set((Array.isArray(job.extraction?.incompleteStages) ? job.extraction.incompleteStages : []).map(Number));
  const neededStages = [[5, "verb_form"], [6, "grammar_vocab_choice"], [7, "error_correction"]].filter(([stage, type]) => incompleteStages.has(Number(stage)) || !executableTypes.has(type as string)).map(([stage]) => stage as number);
  let ai = { stages: { 5: [], 6: [], 7: [] }, tokenUsage: 0, callCount: 0 }, fallbackError = "";
  if (!fullWorkbook || neededStages.length) {
    try { ai = await factoryExercises(rowsForCatalog, fullWorkbook ? neededStages : [5, 6, 7]); }
    catch (error) {
      // A publisher workbook must remain usable when an optional AI fallback
      // is unavailable. Its unverified exercises become validator drops.
      if (!fullWorkbook) throw error;
      fallbackError = error instanceof Error ? clean(error.message, 500) : "factory_ai_fallback_failed";
    }
  }
  const passageId = rows<string>(await db.rpc("ready_create_passage_with_sentences", { p_title: title, p_source_type: sourceType, p_grade: grade, p_source_year: sourceYear, p_source_month: sourceMonth, p_source_label: clean(metadata.sourceLabel, 120), p_rows: rowsForCatalog }));
  const workbookKey = `factory-${passageId}`;
  const provenance = { ...(job.extraction || {}), sourceKind: job.source_kind, documentSha256: clean(metadata.documentSha256, 128), documentName: clean(metadata.documentName, 240), geminiCallCount: ai.callCount, geminiTokenUsage: ai.tokenUsage, pdfExtractedExercises: Number(job.extraction?.exerciseCount) || 0, ...(fallbackError ? { fallbackError } : {}) };
  const catalog = generateWorkbookCatalog({ title: `${title} · READY 워크북`, workbookKey, rows: rowsForCatalog, ai: ai.stages, sourceExercises, provenance });
  const saved = await db.from("ready_workbook_catalogs").insert({ passage_id: passageId, workbook_key: catalog.workbookKey, catalog, provenance, metrics: catalog.metrics, factory_job_id: job.id });
  if (saved.error) { await db.from("ready_passages").delete().eq("id", passageId); throw new ApiError(500, saved.error.message); }
  const completed = await db.from("ready_workbook_factory_jobs").update({ status: "ready", passage_id: passageId, extracted_rows: rowsForCatalog, metrics: catalog.metrics, completed_at: new Date().toISOString(), failure_reason: "" }).eq("id", job.id);
  if (completed.error) throw new ApiError(500, completed.error.message);
  return { passageId, catalog, metrics: catalog.metrics };
}
async function factoryStart(body: any) {
  const sourceKind = body.sourceKind === "pdf" ? "pdf" : "text", title = required(body.title, "지문 제목", 120);
  let sourceText = clean(body.sourceText, 80_000);
  if (sourceKind === "pdf") {
    try { sourceText = await extractUnicodePdfText(body.pdfBase64); }
    catch {
      throw new ApiError(400, "이 PDF의 실제 텍스트를 읽을 수 없습니다. 스캔 PDF는 OCR 후 다시 올리거나, 영문과 한글 문장을 붙여 넣어 주세요.");
    }
  }
  if (!sourceText) throw new ApiError(400, sourceKind === "pdf" ? "텍스트를 추출할 수 없는 PDF입니다. OCR PDF는 지원하지 않습니다." : "본문을 입력해 주세요.");
  const inspected = sourceKind === "pdf" ? inspectFullWorkbookText(sourceText) : { fullWorkbook: false, reviewRequired: true, ...extractSentenceRows(sourceText), exercises: [], headings: [], reason: "passage input requires review" };
  let rowsForReview = inspected.rows || [], translationTokens = 0;
  if (rowsForReview.length && rowsForReview.some((row: any) => !clean(row.translation))) { const translated = await factoryTranslate(rowsForReview); rowsForReview = translated.rows; translationTokens = translated.tokenUsage; inspected.reviewRequired = true; }
  if (!rowsForReview.length) throw new ApiError(400, "영문 문장 경계를 확정하지 못했습니다. 줄바꿈된 영문/한글 문장을 붙여 넣어 주세요.");
  const metadata = { sourceType: body.sourceType, grade: body.grade, sourceYear: body.sourceYear, sourceMonth: body.sourceMonth, sourceLabel: body.sourceLabel, documentName: clean(body.documentName, 240), documentSha256: sourceKind === "pdf" ? await sha256Hex(clean(body.pdfBase64, 20_000_000).replace(/^data:application\/pdf;base64,/i, "")) : "" };
  const extraction = { fullWorkbook: !!inspected.fullWorkbook, reviewRequired: !!inspected.reviewRequired, reason: clean(inspected.reason, 500), headings: inspected.headings || [], exerciseCount: (inspected.exercises || []).length, incompleteStages: inspected.incompleteStages || [], sourceExercises: (inspected.exercises || []).map((exercise: any) => ({ ...exercise, provenance: { page: Number(exercise.page) || null, semanticType: clean(exercise.type, 80), sourceExerciseNumber: Number(exercise.number) || null } })), pairing: inspected.pairing || "pdf" };
  const created = rows<any>(await db.from("ready_workbook_factory_jobs").insert({ status: "review_required", source_kind: sourceKind, title, source_metadata: metadata, extracted_rows: rowsForReview, extraction, metrics: { sentenceCount: rowsForReview.length, geminiCallCount: translationTokens ? 1 : 0, geminiTokenUsage: translationTokens } }).select().single());
  // A full workbook only bypasses the human checkpoint after the parser has
  // deterministic bilingual evidence. It still uses the same final validator.
  if (inspected.fullWorkbook && !inspected.reviewRequired) return { job: created, autoCompleted: true, result: await finalizeFactoryJob(created) };
  return { job: created, autoCompleted: false, reviewRequired: true };
}
async function factoryConfirm(body: any) {
  const jobId = required(body.jobId, "Factory 작업", 80), job = rows<any>(await db.from("ready_workbook_factory_jobs").select("*").eq("id", jobId).maybeSingle());
  if (!job) throw new ApiError(404, "Factory 작업을 찾지 못했습니다.");
  if (job.status === "ready") throw new ApiError(409, "이미 워크북이 생성된 작업입니다.");
  try { return await finalizeFactoryJob(job, body.sentenceRows); }
  catch (error) { await db.from("ready_workbook_factory_jobs").update({ status: "failed", failure_reason: error instanceof Error ? clean(error.message, 500) : "unknown" }).eq("id", job.id); throw error; }
}
async function updatePassage(body: any) {
  const passageId = required(body.passageId, "지문", 80), sourceType = body.sourceType === "MOCK_EXAM" ? "MOCK_EXAM" : "TEXTBOOK", sourceYear = body.sourceYear ? Math.round(Number(body.sourceYear)) : null, sourceMonth = body.sourceMonth ? Math.round(Number(body.sourceMonth)) : null;
  if (sourceType === "MOCK_EXAM" && (!sourceYear || !sourceMonth)) throw new ApiError(400, "모의고사는 연도와 월이 필요합니다.");
  const patch = { title: required(body.title, "지문 제목", 120), source_type: sourceType, grade: required(body.grade, "학년", 40), source_year: sourceYear, source_month: sourceMonth };
  return { passage: rows(await db.from("ready_passages").update(patch).eq("id", passageId).select().single()) };
}
async function deletePassage(body: any) {
  const passageId = required(body.passageId, "지문", 80), result = await db.rpc("ready_delete_passage_cascade", { p_passage_id: passageId });
  if (result.error) throw new ApiError(500, result.error.message); return { deleted: passageId };
}
async function importQuestions(body: any) {
  if (!Array.isArray(body.questions)) throw new ApiError(400, "검증된 Question 배열이 필요합니다.");
  const incoming = structuredClone(body.questions), unresolved = incoming.filter((question: any) => !clean(question?.passage_id, 80));
  if (unresolved.length) {
    const existingRows = rows<any[]>(await db.from("ready_questions").select("passage_id,payload").limit(2_000));
    const byIdentity = new Map<string, string>(), byLesson = new Map<string, Set<string>>();
    for (const row of existingRows) {
      const source = row?.payload?.source || {}, identity = [source.exam, source.passage_no, source.source_question_no, source.section].map(value => clean(value, 180)).join("::");
      if (identity.replaceAll("::", "")) byIdentity.set(identity, clean(row.passage_id, 80));
      if (/민병천|ne\s*능률|공통영어\s*2/i.test(clean(source.exam, 180)) && source.passage_no) {
        const lesson = clean(source.passage_no, 20), ids = byLesson.get(lesson) || new Set<string>();
        if (clean(row.passage_id, 80)) ids.add(clean(row.passage_id, 80));
        byLesson.set(lesson, ids);
      }
    }
    for (const question of unresolved) {
      const source = question?.payload?.source || {}, identity = [source.exam, source.passage_no, source.source_question_no, source.section].map(value => clean(value, 180)).join("::");
      const lessonIds = byLesson.get(clean(source.passage_no, 20));
      question.passage_id = byIdentity.get(identity) || (lessonIds?.size === 1 ? [...lessonIds][0] : "");
      if (!question.passage_id) throw new ApiError(400, `기존 canonical Passage를 찾지 못했습니다: ${clean(question?.passage_key, 120) || identity}`);
    }
  }
  for (const [index, question] of incoming.entries()) {
    if (!["exam4you", "nernter"].includes(clean(question?.payload?.source?.provider, 30))) throw new ApiError(400, `${index + 1}번 문제의 source provider가 없거나 지원되지 않습니다.`);
    const validation = validateQuestionSpec(question?.payload || {}, clean(question?.type, 40), clean(question?.status, 20) || "draft");
    if (validation.errors.length) throw new ApiError(400, `${index + 1}번 문제의 출제 명세가 불완전합니다: ${validation.errors.join(", ")}`);
    if (validation.spec.importStatus === "ready" && question?.status !== "available") throw new ApiError(400, `${index + 1}번 문제는 ready이므로 available 상태여야 합니다.`);
    if (validation.spec.importStatus !== "ready" && question?.status === "available") throw new ApiError(400, `${index + 1}번 문제는 검수 전이므로 공개할 수 없습니다.`);
    if(Number(question?.payload?.publication_version)!==CURRENT_QUESTION_PUBLICATION_VERSION)throw new ApiError(400,`${index + 1}번 문제는 현재 publication pipeline v${CURRENT_QUESTION_PUBLICATION_VERSION} 검증이 필요합니다.`);
  }
  const result = await db.rpc("ready_import_question_bundle", { p_questions: incoming });
  if (result.error) throw new ApiError(400, result.error.message);
  const relink = await db.rpc("ready_relink_ne_minbyeongcheon_lessons");
  if (relink.error) throw new ApiError(500, relink.error.message);
  return { imported: Number(result.data) || 0 };
}
async function importExplanations(body: any) {
  if (!Array.isArray(body.explanations)) throw new ApiError(400, "검증된 PDF 해설 배열이 필요합니다.");
  const result = await db.rpc("ready_import_question_explanations", { p_explanations: body.explanations });
  if (result.error) throw new ApiError(400, result.error.message);
  return { imported: Number(result.data) || 0 };
}

async function studentExamAccess(examId: string, student: Student) {
  const result = await db.from("ready_exams").select("id").eq("id", examId).eq("school", student.school).eq("grade", student.grade).eq("is_current", true).maybeSingle();
  if (result.error) throw new ApiError(500, result.error.message); if (!result.data) throw new ApiError(404, "현재 배정된 시험범위가 아닙니다."); return result.data as any;
}
function questionStudyText(payload: any) { return clean(payload?.set_text || payload?.variant_text, 30_000); }
function englishTokens(value: unknown) { return clean(value, 40_000).toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/g) || []; }
function isDialogueText(value: unknown) {
  const text = clean(value, 40_000);
  return (text.match(/(?:^|\s)[A-Z]{1,3}:\s/g) || []).length >= 3;
}
function isNeTextbookQuestion(row: any, passage: any) {
  return /민병천|ne\s*능률|공통영어\s*2/i.test([row?.payload?.source?.exam, passage?.source_label, passage?.title].map(value => clean(value, 300)).join(" "));
}
function isMainTextQuestion(row: any, passage: any, passageText: string) {
  if (!isNeTextbookQuestion(row, passage)) return true;
  const declared = clean(row?.payload?.source_kind, 40);
  if (declared) return declared === "textbook_main";
  const studyText = questionStudyText(row?.payload);
  if (!studyText || isDialogueText(studyText)) return false;
  const source = englishTokens(passageText), candidate = englishTokens(studyText);
  if (source.length < 12 || candidate.length < 12) return false;
  const sourceBigrams = new Set(source.slice(0, -1).map((token, index) => `${token} ${source[index + 1]}`));
  const candidateBigrams = candidate.slice(0, -1).map((token, index) => `${token} ${candidate[index + 1]}`);
  const matched = candidateBigrams.filter(bigram => sourceBigrams.has(bigram)).length;
  return matched / Math.max(1, candidateBigrams.length) >= .34;
}
function questionSourceKey(row: any) {
  const source = row?.payload?.source || {};
  return [clean(source.exam, 200), clean(source.section, 40), Number(source.passage_no) || 0].join("|");
}
function normalizeMainTextQuestionRows(questionRows: any[], passage: any, passageText: string) {
  // A Question is the scheduling and rendering unit.  Never infer its text
  // from a previous row: that made a later question inherit question 1's
  // blanks and labels, and prevented random/type/difficulty composition.
  void passage; void passageText;
  return [...questionRows].sort((a, b) => (Number(a?.payload?.position) || 0) - (Number(b?.payload?.position) || 0));
}
async function attemptedQuestionIds(studentId: string, examId: string) {
  const attempts = rows<any[]>(await db.from("ready_attempts").select("question_id").eq("student_id", studentId).eq("exam_id", examId));
  return new Set(attempts.map(attempt => attempt.question_id));
}
async function scopePassages(examId: string, studentId: string) {
  const links = rows<any[]>(await db.from("ready_exam_passages").select("passage_id,position").eq("exam_id", examId).order("position"));
  const linkedIds = links.map(item => item.passage_id);
  const sourcePassages = linkedIds.length ? rows<any[]>(await db.from("ready_passages").select("id,title,source_type,source_label").in("id", linkedIds)) : [];
  const sentenceRows = linkedIds.length ? rows<any[]>(await db.from("ready_passage_sentences").select("passage_id,sentence_index,text").in("passage_id", linkedIds).order("sentence_index")) : [];
  const availableQuestions = linkedIds.length ? rows<any[]>(await db.from("ready_questions").select("id,passage_id,type,status,payload").in("passage_id", linkedIds).in("type", ["multiple_choice", "written_response"]).eq("status", "available")) : [];
  const factoryCatalogs = linkedIds.length ? rows<any[]>(await db.from("ready_workbook_catalogs").select("passage_id").in("passage_id", linkedIds)) : [];
  const factoryPassageIds = new Set(factoryCatalogs.map(row => row.passage_id));
  const attempted = await attemptedQuestionIds(studentId, examId);
  const questionCounts = new Map<string, number>();
  const byId = new Map(sourcePassages.map(item => [item.id, item]));
  const passageText = new Map(linkedIds.map(id => [id, sentenceRows.filter(sentence => sentence.passage_id === id).map(sentence => sentence.text).join(" ")]));
  const normalizedQuestions = linkedIds.flatMap(passageId => normalizeMainTextQuestionRows(availableQuestions.filter(question => question.passage_id === passageId), byId.get(passageId), passageText.get(passageId) || ""));
  normalizedQuestions.forEach(question => {
    const passage = byId.get(question.passage_id);
    if (!attempted.has(question.id) && isReadyQuestion(question) && isMainTextQuestion(question, passage, passageText.get(question.passage_id) || "")) questionCounts.set(question.passage_id, (questionCounts.get(question.passage_id) || 0) + 1);
  });
  const passages = links.map(link => {
    const passage = byId.get(link.passage_id);
    return passage ? { ...passage, position: link.position, question_count: questionCounts.get(link.passage_id) || 0, has_workbook: !!codeWorkbookForPassage(passage) || factoryPassageIds.has(passage.id) } : null;
  }).filter(Boolean);
  return passages;
}
async function studentBootstrap(session: ReadySession) {
  const student = await studentForSession(session), scope = rows<any>(await db.from("ready_exams").select("id,school,grade").eq("school", student.school).eq("grade", student.grade).eq("is_current", true).maybeSingle());
  const passages = scope ? await scopePassages(scope.id, student.id) : [];
  let reviewCount=0,savedWords:any[]=[];if(scope){const [wordRows,sentenceCount]=await Promise.all([savedWordList(student.id,scope.id),db.from("ready_saved_sentences").select("id",{count:"exact",head:true}).eq("student_id",student.id).eq("exam_id",scope.id)]);if(sentenceCount.error)throw new ApiError(500,sentenceCount.error.message);savedWords=wordRows;reviewCount=(await eligibleReviewQuestionIds(student.id,scope.id)).length+await workbookReviewCount(student.id,scope.id)+savedWords.length+(sentenceCount.count||0);}
  return { student: { id: student.id, school: student.school, grade: student.grade }, scope, passages, savedWords, reviewCount };
}
async function studentPassageAccess(examId: string, passageId: string, student: Student) { await studentExamAccess(examId, student); const linked = await db.from("ready_exam_passages").select("passage_id").eq("exam_id", examId).eq("passage_id", passageId).maybeSingle(); if (linked.error) throw new ApiError(500, linked.error.message); if (!linked.data) throw new ApiError(404, "현재 시험범위에 없는 지문입니다."); return rows<any>(await db.from("ready_passages").select("id,title,source_type,source_label,updated_at").eq("id", passageId).single()); }
async function savedWordList(studentId:string,examId:string){
  const parents=await db.from("ready_saved_words").select("id,normalized_word,meaning_snapshot,memory_level,created_at").eq("student_id",studentId).eq("exam_id",examId).order("updated_at",{ascending:false});if(parents.error)throw new ApiError(500,parents.error.message);const rowsSaved=rows<any[]>(parents);if(!rowsSaved.length)return [];
  const senses=await db.from("ready_saved_word_senses").select("id,saved_word_id,meaning,origin_occurrence_key,created_at").in("saved_word_id",rowsSaved.map(item=>item.id)).order("created_at",{ascending:false});if(senses.error)throw new ApiError(500,senses.error.message);const byParent=new Map<string,any[]>();for(const sense of rows<any[]>(senses)){const list=byParent.get(sense.saved_word_id)||[];list.push({id:sense.id,meaning:sense.meaning,occurrenceKey:sense.origin_occurrence_key||null});byParent.set(sense.saved_word_id,list);}
  return rowsSaved.map(item=>({id:item.id,lemma:item.normalized_word,meaning:item.meaning_snapshot,memoryLevel:Number(item.memory_level)||1,senses:byParent.get(item.id)||[]}));
}
async function studentPassage(body: any, session: ReadySession) {
  const student=await studentForSession(session),examId=required(body.examId,"Exam",80),passageId=required(body.passageId,"지문",80),passage=await studentPassageAccess(examId,passageId,student);
  const [sentences,savedWords]=await Promise.all([
    db.from("ready_passage_sentences").select("id,sentence_index,text,translation").eq("passage_id",passageId).order("sentence_index"),
    savedWordList(student.id,examId),
  ]);
  return {passage,sentences:rows<any[]>(sentences),savedWords};
}
function answerIndexes(value: unknown, choiceCount: number) {
  if (!Array.isArray(value)) throw new ApiError(500, "문제 정답 형식이 올바르지 않습니다.");
  const indexes = [...new Set(value.map(item => Number(item)).filter(item => Number.isInteger(item) && item >= 0 && item < choiceCount))].sort((a, b) => a - b);
  if (!indexes.length || indexes.length !== value.length) throw new ApiError(500, "문제 정답 형식이 올바르지 않습니다.");
  return indexes;
}
function publicTargetRanges(value: unknown) {
  return (Array.isArray(value) ? value : []).slice(0, 8).map((target: any) => ({ label: clean(target?.label, 20), text: clean(target?.text, 200), canonicalText: clean(target?.canonical_text ?? target?.canonicalText, 200) || clean(target?.text, 200) })).filter(target => target.label && target.text);
}
function answerWordCount(slot: unknown) {
  const variants = (Array.isArray(slot) ? slot : [slot]).map(value => clean(value, 2_000)).filter(Boolean);
  const counts = [...new Set(variants.map(value => (value.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g) || []).length))];
  return counts.length === 1 && counts[0] > 0 ? counts[0] : null;
}
function cleanWritingBank(value: unknown) {
  const result: string[] = [];
  for (const raw of cleanList(value, 60, 500)) {
    const relevant = raw.includes("<보기>") ? raw.split("<보기>").pop() || "" : raw;
    const pieces = relevant.split(/\s*[,/]\s*|\s{2,}/).map(item => item.replace(/^[^A-Za-z]+|[^A-Za-z0-9'’., -]+$/g, "").trim()).filter(Boolean);
    for (const piece of pieces) {
      const wordCount = (piece.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g) || []).length;
      const apparatus = /[_＿]{2,}|[ⓐ-ⓩ]|\([A-H]\)|→|\b(?:What|Why|How|Where|When|Who|Which)\b/i.test(piece);
      if (/[A-Za-z]/.test(piece) && !/[가-힣]/.test(piece) && wordCount > 0 && wordCount <= 12 && !apparatus && !result.includes(piece)) result.push(piece);
    }
  }
  return result.slice(0, 40);
}
function publicStoredWritingGuide(value: any) {
  if (!value || typeof value !== "object") return null;
  const rawConditions = cleanList(value.conditions, 20, 500), bankFromConditions: string[] = [];
  const conditions = rawConditions.filter(item => {
    const english = item.match(/[A-Za-z]+(?:['’ -][A-Za-z0-9]+)*/g) || [];
    const looksLikeBank = !/[가-힣]/.test(item) && english.length >= 4;
    if (looksLikeBank) bankFromConditions.push(item);
    return !looksLikeBank && !item.includes("<보기>");
  });
  const guide = {
    kind: clean(value.kind, 40) || "sentence",
    title: clean(value.title, 1_000),
    slotLabels: cleanList(value.slot_labels, 12, 80),
    conditions: conditions.slice(0, 12),
    wordBank: cleanWritingBank([...(Array.isArray(value.word_bank) ? value.word_bank : []), ...bankFromConditions]),
    targets: publicTargetRanges(value.targets),
    taskText: clean(value.task_text, 2_000),
    taskLabel: clean(value.task_label, 80),
  };
  return guide.title || guide.slotLabels.length || guide.conditions.length || guide.wordBank.length || guide.targets.length || guide.taskText ? guide : null;
}
function cleanQuestionText(value: unknown) {
  return clean(value, 30_000)
    .replace(/^\s*(?:[※]\s*)?다음\s*(?:글|대화)(?:을|를)\s*읽고\s*(?:다음\s*)?물음에\s*답하시오\s*[.!?]?\s*/u, "")
    .replace(/\s+/g, " ").trim();
}
function publicSkill(taxonomy: string) {
  if (taxonomy.startsWith("grammar_")) return "grammar";
  if (taxonomy.startsWith("vocabulary_")) return "vocabulary";
  if (taxonomy.startsWith("blank_")) return "blank";
  if (taxonomy === "sentence_insertion") return "insertion";
  if (taxonomy === "paragraph_order") return "order";
  if (taxonomy.startsWith("summary_")) return "summary";
  if (["topic", "title", "main_idea", "purpose", "emotion", "content_true", "content_false", "unanswerable"].includes(taxonomy)) return "comprehension";
  return taxonomy;
}
function publicTaxonomyLabel(taxonomy: string) {
  const labels: Record<string, string> = {
    topic: "주제", title: "제목", main_idea: "요지", purpose: "목적", emotion: "심경·분위기",
    content_true: "내용 일치", content_false: "내용 불일치", unanswerable: "답할 수 없는 질문",
    grammar_single_error: "어법 단일 오류", grammar_multi_error: "어법 복수 오류", grammar_ab: "어법 A/B",
    vocabulary_context: "문맥 어휘", blank_word: "빈칸 단어", blank_phrase: "빈칸 구",
    sentence_insertion: "문장 삽입", irrelevant_sentence: "무관한 문장", paragraph_order: "문단 순서",
    summary_two_blank: "요약 빈칸", guided_writing: "조건 영작", translation: "영작·해석",
    arrangement: "순서 배열", correction: "어색한 곳 고치기", summary_completion: "서술형 요약",
    reference: "지칭 추론",
  };
  return labels[taxonomy] || taxonomy.replaceAll("_", " ");
}
function publicQuestion(row: any, passageText = "", studentState: { bookmarked?: boolean; lastResult?: boolean | null } = {}) {
  const payload = row.payload || {}, type = clean(row.type, 40), sourceQuestionNo = Number(payload.source?.source_question_no) || null;
  const specValidation = validateQuestionSpec(payload, type, row.status || "available"), renderSpec = specValidation.spec;
  if (!specValidation.ready) throw new ApiError(409, `검수가 끝나지 않은 문제입니다: ${specValidation.errors.join(", ")}`);
  const interactionContract = publicInteractionContract(payload.spec?.interaction);
  if (!interactionContract) throw new ApiError(409, "상호작용 계약이 없는 문제입니다.");
  const choices = interactionContract.choices.rows.map((row: any) => row.cells.join(" "));
  const choiceParts = interactionContract.kind === "choice_matrix" ? interactionContract.choices.rows.map((row: any) => row.cells) : [];
  const writingGuide = type === "written_response" ? publicStoredWritingGuide(payload.writing_guide) : null;
  const responseSlots = interactionContract.response.slots;
  const inlineGroups = interactionContract.passage.segments.filter((segment: any) => segment.kind === "inline_options");
  const targetRanges = interactionContract.passage.segments.filter((segment: any) => segment.kind === "annotation").map((segment: any) => ({ label: segment.label, text: segment.text, canonicalText: segment.text }));
  const summaryText = renderSpec.extras.includes("summary") ? clean(payload.summary_text, 10_000) : "";
  return {
    id: row.id, passageId: row.passage_id, type, family: clean(payload.family, 40) || (type === "written_response" ? "written" : "standard"), skill: publicSkill(renderSpec.taxonomy),
    taxonomy: renderSpec.taxonomy, renderer: renderSpec.renderer, renderSpec, importStatus: renderSpec.importStatus,
    prompt: clean(payload.prompt, 1_000), choices, choiceParts, multiSelect: interactionContract.selection === "multi", responseType: type === "written_response" ? "written" : "choice", responseSlots, writingGuide,
    grading: deterministicClientContract(payload, type), explanation: clean(payload.explanation, 4_000),
    passageText: cleanQuestionText(passageText), interaction: interactionContract.kind, interactionContract,
    stimulus: renderSpec.extras.includes("stimulus") ? clean(payload.stimulus, 10_000) : "", summaryText, inlineGroups, targetRanges,
    bookmarked: studentState.bookmarked === true, lastResult: typeof studentState.lastResult === "boolean" ? studentState.lastResult : null,
    source: payload.source ? { provider: clean(payload.source.provider, 30), exam: clean(payload.source.exam, 160), passageNo: Number(payload.source.passage_no) || null, questionNo: sourceQuestionNo, section: clean(payload.source.section, 20), setId: clean(payload.source.set_id, 120) || null } : null,
  };
}
function isReadyQuestion(row: any) { return validateQuestionSpec(row?.payload || {}, clean(row?.type, 40), row?.status || "available").ready; }
async function studentQuestionPool(student: Student, examId: string) {
  await studentExamAccess(examId, student);
  const links = rows<any[]>(await db.from("ready_exam_passages").select("passage_id,position").eq("exam_id", examId).order("position"));
  const passageIds = links.map(link => link.passage_id);
  if (!passageIds.length) return [];
  const passageRows = rows<any[]>(await db.from("ready_passages").select("id,title,source_type,source_label").in("id", passageIds));
  const sentenceRows = rows<any[]>(await db.from("ready_passage_sentences").select("passage_id,sentence_index,text").in("passage_id", passageIds).order("sentence_index"));
  const questionRows = rows<any[]>(await db.from("ready_questions").select("id,passage_id,type,payload,status,created_at").in("passage_id", passageIds).in("type", ["multiple_choice", "written_response"]).eq("status", "available"));
  const attempted = await attemptedQuestionIds(student.id, examId);
  const bookmarkRows = rows<any[]>(await db.from("ready_question_bookmarks").select("question_id").eq("student_id", student.id).eq("exam_id", examId));
  const bookmarks = new Set(bookmarkRows.map(item => item.question_id));
  const passages = new Map(passageRows.map(passage => [passage.id, passage]));
  const passageText = new Map(passageIds.map(id => [id, sentenceRows.filter(sentence => sentence.passage_id === id).map(sentence => sentence.text).join(" ")]));
  const linkPosition = new Map(links.map(link => [link.passage_id, Number(link.position) || 0]));
  return passageIds.flatMap(passageId => normalizeMainTextQuestionRows(questionRows.filter(row => row.passage_id === passageId), passages.get(passageId), passageText.get(passageId) || ""))
    .filter(row => !attempted.has(row.id) && isReadyQuestion(row) && isMainTextQuestion(row, passages.get(row.passage_id), passageText.get(row.passage_id) || ""))
    .map(row => ({ row, passageText: passageText.get(row.passage_id) || "", bookmarked: bookmarks.has(row.id), passagePosition: linkPosition.get(row.passage_id) || 0 }))
    .sort((a, b) => a.passagePosition - b.passagePosition || (Number(a.row.payload?.position) || 0) - (Number(b.row.payload?.position) || 0));
}
async function studentQuestionFilters(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), pool = await studentQuestionPool(student, examId);
  const sources = [
    { id: "exam4you", label: "Exam4you", count: pool.filter(item => item.row.payload?.source?.provider === "exam4you").length },
    { id: "nernter", label: "너른터", count: pool.filter(item => item.row.payload?.source?.provider === "nernter").length },
  ];
  const typeCounts = new Map<string, number>();
  for (const item of pool) { const taxonomy = clean(item.row.payload?.spec?.taxonomy || item.row.payload?.taxonomy, 60); if (taxonomy) typeCounts.set(taxonomy, (typeCounts.get(taxonomy) || 0) + 1); }
  const types = [...typeCounts.entries()].map(([id, count]) => ({ id, label: publicTaxonomyLabel(id), count })).sort((a, b) => a.label.localeCompare(b.label, "ko"));
  return { total: pool.length, sources, types };
}
async function studentQuestionQueue(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), pool = await studentQuestionPool(student, examId);
  const providers = cleanList(body.providers, 2, 30), taxonomies = cleanList(body.taxonomies, 60, 60);
  if (providers.some(provider => !["exam4you", "nernter"].includes(provider))) throw new ApiError(400, "지원하지 않는 문제 출처입니다.");
  const providerSet = new Set(providers), taxonomySet = new Set(taxonomies);
  const selected = pool.filter(item => (!providerSet.size || providerSet.has(clean(item.row.payload?.source?.provider, 30))) && (!taxonomySet.size || taxonomySet.has(clean(item.row.payload?.spec?.taxonomy || item.row.payload?.taxonomy, 60))));
  const savedWords=await savedWordList(student.id,examId);
  return { items: selected.map(item => publicQuestion(item.row, item.passageText, { bookmarked: item.bookmarked })), savedWords };
}
async function studentQuestions(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80);
  const study = await studentPassage(body, session), passageId = study.passage.id;
  const questionRows = rows<any[]>(await db.from("ready_questions").select("id,passage_id,type,payload,status,created_at").eq("passage_id", passageId).in("type", ["multiple_choice", "written_response"]).eq("status", "available").order("created_at"));
  questionRows.sort((a, b) => (Number(a.payload?.position) || 0) - (Number(b.payload?.position) || 0));
  const passageText = study.sentences.map((sentence: any) => sentence.text).join(" ");
  const attempted = await attemptedQuestionIds(student.id, examId);
  const bookmarks = rows<any[]>(await db.from("ready_question_bookmarks").select("question_id").eq("student_id", student.id).eq("exam_id", examId));
  const bookmarkIds = new Set(bookmarks.map(item => item.question_id));
  const normalizedQuestions = normalizeMainTextQuestionRows(questionRows, study.passage, passageText);
  return { ...study, questions: normalizedQuestions.filter(row => !attempted.has(row.id) && isReadyQuestion(row) && isMainTextQuestion(row, study.passage, passageText)).map(row => publicQuestion(row, passageText, { bookmarked: bookmarkIds.has(row.id) })) };
}
async function unresolvedQuestionIds(studentId: string, examId: string) {
  const attempts = rows<any[]>(await db.from("ready_attempts").select("question_id,correct,created_at").eq("student_id", studentId).eq("exam_id", examId).order("created_at", { ascending: false }));
  const latest = new Map<string, boolean>();
  for (const attempt of attempts) if (!latest.has(attempt.question_id)) latest.set(attempt.question_id, attempt.correct === true);
  return [...latest.entries()].filter(([, correct]) => !correct).map(([questionId]) => questionId);
}
async function eligibleUnresolvedQuestionIds(studentId: string, examId: string) {
  const questionIds = await unresolvedQuestionIds(studentId, examId);
  if (!questionIds.length) return [];
  const unresolvedQuestions = rows<any[]>(await db.from("ready_questions").select("id,passage_id,payload").in("id", questionIds).eq("status", "available"));
  const passageIds = [...new Set(unresolvedQuestions.map(question => question.passage_id))];
  const questions = passageIds.length ? rows<any[]>(await db.from("ready_questions").select("id,passage_id,payload").in("passage_id", passageIds).eq("status", "available")) : [];
  const passages = passageIds.length ? rows<any[]>(await db.from("ready_passages").select("id,title,source_type,source_label").in("id", passageIds)) : [];
  const sentences = passageIds.length ? rows<any[]>(await db.from("ready_passage_sentences").select("passage_id,sentence_index,text").in("passage_id", passageIds).order("sentence_index")) : [];
  const passageById = new Map(passages.map(passage => [passage.id, passage]));
  const textById = new Map(passageIds.map(id => [id, sentences.filter(sentence => sentence.passage_id === id).map(sentence => sentence.text).join(" ")]));
  const unresolved = new Set(questionIds);
  return passageIds.flatMap(passageId => normalizeMainTextQuestionRows(questions.filter(question => question.passage_id === passageId), passageById.get(passageId), textById.get(passageId) || ""))
    .filter(question => unresolved.has(question.id) && isMainTextQuestion(question, passageById.get(question.passage_id), textById.get(question.passage_id) || "")).map(question => question.id);
}
async function eligibleReviewQuestionIds(studentId: string, examId: string) {
  const bookmarkRows = rows<any[]>(await db.from("ready_question_bookmarks").select("question_id").eq("student_id", studentId).eq("exam_id", examId));
  if (!bookmarkRows.length) return [];
  const bookmarked = new Set(bookmarkRows.map(item => item.question_id));
  const questions = rows<any[]>(await db.from("ready_questions").select("id,passage_id,payload,status").in("id", [...bookmarked]).eq("status", "available"));
  const passageIds = [...new Set(questions.map(question => question.passage_id))];
  const passages = passageIds.length ? rows<any[]>(await db.from("ready_passages").select("id,title,source_type,source_label").in("id", passageIds)) : [];
  const sentences = passageIds.length ? rows<any[]>(await db.from("ready_passage_sentences").select("passage_id,sentence_index,text").in("passage_id", passageIds).order("sentence_index")) : [];
  const passageById = new Map(passages.map(passage => [passage.id, passage]));
  const textById = new Map(passageIds.map(id => [id, sentences.filter(sentence => sentence.passage_id === id).map(sentence => sentence.text).join(" ")]));
  return questions.filter(question => isReadyQuestion(question) && isMainTextQuestion(question, passageById.get(question.passage_id), textById.get(question.passage_id) || "")).map(question => question.id);
}
async function latestAttemptResults(studentId: string, examId: string) {
  const attempts = rows<any[]>(await db.from("ready_attempts").select("question_id,correct,created_at").eq("student_id", studentId).eq("exam_id", examId).order("created_at", { ascending: false }));
  const latest = new Map<string, boolean>();
  for (const attempt of attempts) if (!latest.has(attempt.question_id)) latest.set(attempt.question_id, attempt.correct === true);
  return latest;
}
async function wordReviewItems(studentId:string,examId:string){
  const savedResult=await db.from("ready_saved_words").select("id,passage_id,word,normalized_word,meaning_snapshot,memory_level,created_at").eq("student_id",studentId).eq("exam_id",examId).order("created_at",{ascending:false});if(savedResult.error)throw new ApiError(500,savedResult.error.message);const saved=rows<any[]>(savedResult);if(!saved.length)return [];
  const senseResult=await db.from("ready_saved_word_senses").select("id,saved_word_id,meaning,origin_occurrence_key,created_at").in("saved_word_id",saved.map(item=>item.id)).order("created_at",{ascending:false});if(senseResult.error)throw new ApiError(500,senseResult.error.message);const sensesByWord=new Map<string,any[]>();for(const sense of rows<any[]>(senseResult)){const list=sensesByWord.get(sense.saved_word_id)||[];list.push({id:sense.id,meaning:sense.meaning,occurrenceKey:sense.origin_occurrence_key||null});sensesByWord.set(sense.saved_word_id,list);}
  const lemmas=[...new Set(saved.map(item=>item.normalized_word))],eventsResult=await db.from("ready_word_lookup_events").select("id,passage_id,sentence_id,surface_word,normalized_word,source_text_snapshot,english_sentence_snapshot,publisher_translation_snapshot,meaning_snapshot,source_kind,source_key,occurrence_key,created_at").eq("student_id",studentId).eq("exam_id",examId).eq("resolved",true).in("normalized_word",lemmas).order("created_at",{ascending:false});if(eventsResult.error)throw new ApiError(500,eventsResult.error.message);const events=rows<any[]>(eventsResult),passageIds=[...new Set([...saved.map(item=>item.passage_id),...events.map(item=>item.passage_id)].filter(Boolean))],passageResult=passageIds.length?await db.from("ready_passages").select("id,title,source_label").in("id",passageIds):{data:[],error:null};if(passageResult.error)throw new ApiError(500,passageResult.error.message);const passageById=new Map((passageResult.data||[]).map(item=>[item.id,item]));
  return saved.map(item=>{const seen=new Set<string>(),examples=[];for(const event of events){if(event.normalized_word!==item.normalized_word||!event.occurrence_key||seen.has(event.occurrence_key))continue;seen.add(event.occurrence_key);examples.push({occurrenceKey:event.occurrence_key,surface:event.surface_word,sourceSpan:event.source_text_snapshot,englishSentence:event.english_sentence_snapshot,publisherTranslation:event.publisher_translation_snapshot,meaning:event.meaning_snapshot,sourceKind:event.source_kind||"reader",sourceKey:event.source_key||"",passageTitle:passageById.get(event.passage_id)?.title||"",sourceLabel:passageById.get(event.passage_id)?.source_label||"",createdAt:event.created_at});}return {id:item.id,word:item.word,lemma:item.normalized_word,meaning:item.meaning_snapshot,senses:sensesByWord.get(item.id)||[],memoryLevel:Number(item.memory_level)||1,exampleCount:examples.length,createdAt:item.created_at,examples};});
}
async function studentReviewQuestions(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80);
  await studentExamAccess(examId, student);
  const questionIds = await eligibleReviewQuestionIds(student.id, examId);
  let items: any[] = [];
  if (questionIds.length) {
    const unresolvedRows = rows<any[]>(await db.from("ready_questions").select("id,passage_id,type,payload,status,created_at").in("id", questionIds).in("type", ["multiple_choice", "written_response"]).eq("status", "available"));
    const passageIds = [...new Set(unresolvedRows.map(question => question.passage_id))];
    if (passageIds.length) {
      const questionRows = rows<any[]>(await db.from("ready_questions").select("id,passage_id,type,payload,status,created_at").in("passage_id", passageIds).in("type", ["multiple_choice", "written_response"]).eq("status", "available"));
      const sentenceRows = rows<any[]>(await db.from("ready_passage_sentences").select("passage_id,sentence_index,text").in("passage_id", passageIds).order("sentence_index"));
      const passageRows = rows<any[]>(await db.from("ready_passages").select("id,title,source_type,source_label").in("id", passageIds));
      const passages = new Map(passageRows.map(passage => [passage.id, passage])), passageText = new Map<string, string>();
      for (const passageId of passageIds) passageText.set(passageId, sentenceRows.filter(sentence => sentence.passage_id === passageId).map(sentence => sentence.text).join(" "));
      const review = new Set(questionIds), latest = await latestAttemptResults(student.id, examId), bookmarkRows = rows<any[]>(await db.from("ready_question_bookmarks").select("question_id").eq("student_id", student.id).eq("exam_id", examId)), bookmarks = new Set(bookmarkRows.map(item => item.question_id));
      const normalizedQuestions = passageIds.flatMap(passageId => normalizeMainTextQuestionRows(questionRows.filter(row => row.passage_id === passageId), passages.get(passageId), passageText.get(passageId) || ""));
      normalizedQuestions.sort((a, b) => (Number(a.payload?.source?.passage_no) || 0) - (Number(b.payload?.source?.passage_no) || 0) || (Number(a.payload?.position) || 0) - (Number(b.payload?.position) || 0));
      items = normalizedQuestions.filter(row => review.has(row.id) && isReadyQuestion(row) && isMainTextQuestion(row, passages.get(row.passage_id), passageText.get(row.passage_id) || "")).map(row => ({ question: publicQuestion(row, passageText.get(row.passage_id) || "", { bookmarked: bookmarks.has(row.id), lastResult: latest.get(row.id) }) }));
    }
  }
  const [wordItems,workbookItems,sentenceResult]=await Promise.all([wordReviewItems(student.id,examId),workbookReviewItems(student.id,examId),db.from("ready_saved_sentences").select("id,source_text_snapshot,translation_snapshot,created_at,passage:ready_passages(title)").eq("student_id",student.id).eq("exam_id",examId).order("created_at",{ascending:false})]);if(sentenceResult.error)throw new ApiError(500,sentenceResult.error.message);
  return { items, wordItems, sentenceItems:rows<any[]>(sentenceResult), workbookItems, counts:{word:wordItems.length,sentence:(sentenceResult.data||[]).length,workbook:workbookItems.length,question:items.length} };
}
async function setQuestionBookmark(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), questionId = required(body.questionId, "문제", 80), bookmarked = body.bookmarked === true;
  await studentExamAccess(examId, student);
  const question = rows<any>(await db.from("ready_questions").select("id,passage_id,payload,status").eq("id", questionId).eq("status", "available").maybeSingle());
  if (!question || !isReadyQuestion(question)) throw new ApiError(404, "현재 저장할 수 없는 문제입니다.");
  await studentPassageAccess(examId, question.passage_id, student);
  if (bookmarked) {
    const saved = await db.from("ready_question_bookmarks").upsert({ student_id: student.id, exam_id: examId, question_id: questionId, source: "manual", updated_at: new Date().toISOString() }, { onConflict: "student_id,exam_id,question_id" });
    if (saved.error) throw new ApiError(500, saved.error.message);
  } else {
    const removed = await db.from("ready_question_bookmarks").delete().eq("student_id", student.id).eq("exam_id", examId).eq("question_id", questionId);
    if (removed.error) throw new ApiError(500, removed.error.message);
  }
  return { bookmarked, reviewCount: (await eligibleReviewQuestionIds(student.id, examId)).length + await workbookReviewCount(student.id, examId) };
}
async function submitAttempt(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), questionId = required(body.questionId, "문제", 80);
  const question = rows<any>(await db.from("ready_questions").select("id,passage_id,type,payload,status").eq("id", questionId).in("type", ["multiple_choice", "written_response"]).eq("status", "available").maybeSingle());
  if (!question) throw new ApiError(404, "현재 풀 수 없는 문제입니다.");
  if (!isReadyQuestion(question)) throw new ApiError(409, "검수가 끝나지 않은 문제입니다.");
  await studentPassageAccess(examId, question.passage_id, student);
  const spec = publicQuestion(question); let response: any, answer: any, correct = false, aiFeedback = "", aiRequestId: string | null = null;
  if (question.type === "multiple_choice") {
    response = spec.interaction === "inline_options" ? { inlineSelected: Array.isArray(body.inlineSelected) ? body.inlineSelected.map(Number) : [] } : { selected: answerIndexes(body.selected, spec.choices.length) };
    const grade = deterministicGrade(question.payload, question.type, response);
    if (!grade.valid) throw new ApiError(400, spec.interaction === "inline_options" ? "본문의 모든 선택지를 골라 주세요." : spec.multiSelect ? "필요한 답을 모두 선택해 주세요." : "답을 하나만 선택해 주세요.");
    correct = grade.correct; answer = grade.answer;
  } else {
    const responses = cleanList(body.responses, 12, 2_000), accepted = Array.isArray(question.payload?.accepted_answers) ? question.payload.accepted_answers : [];
    const deterministic = deterministicGrade(question.payload, question.type, { responses });
    if (!deterministic.valid) throw new ApiError(400, "모든 답을 입력해 주세요.");
    correct = deterministic.correct;
    response = { responses }; answer = accepted.map((slot: unknown) => (Array.isArray(slot) ? slot : [slot]).map(candidate => clean(candidate, 2_000)));
    if (!correct) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const used = await db.from("ready_ai_grading_requests").select("id", { count: "exact", head: true }).eq("student_id", student.id).gte("created_at", today.toISOString());
      if (used.error) throw new ApiError(500, used.error.message);
      if ((used.count || 0) >= AI_GRADING_DAILY_LIMIT) throw new ApiError(429, `오늘 AI 채점 ${AI_GRADING_DAILY_LIMIT}회를 모두 사용했습니다.`);
      const privateSlots = (Array.isArray(question.payload?.response_slots) ? question.payload.response_slots : []).map((slot: any, index: number) => ({ label: clean(slot?.label, 80) || `답 ${index + 1}`, wordCount: Number(slot?.word_count) || answerWordCount(question.payload?.accepted_answers?.[index]) }));
      const rubric = { prompt: spec.prompt, taskText: spec.writingGuide?.taskText || "", conditions: spec.writingGuide?.conditions || [], wordBank: spec.writingGuide?.wordBank || [], responseSlots: privateSlots, referenceAnswers: answer };
      const pending = rows<any>(await db.from("ready_ai_grading_requests").insert({ student_id: student.id, exam_id: examId, question_id: question.id, response, rubric_snapshot: rubric, status: "pending" }).select("id").single());
      aiRequestId = pending.id;
      try {
        const grade = await callGeminiGrade(question, spec, responses);
        correct = grade.correct; aiFeedback = grade.shortFeedback;
        const completed = await db.from("ready_ai_grading_requests").update({ status: "completed", result: { correct: grade.correct, score: grade.score, short_feedback: grade.shortFeedback, error_tags: grade.errorTags }, completed_at: new Date().toISOString() }).eq("id", aiRequestId).eq("status", "pending");
        if (completed.error) throw new ApiError(500, completed.error.message);
      } catch (error) {
        await db.from("ready_ai_grading_requests").update({ status: "failed", error_code: error instanceof ApiError ? `http_${error.status}` : "unknown", completed_at: new Date().toISOString() }).eq("id", aiRequestId).eq("status", "pending");
        throw error;
      }
    }
  }
  const elapsedMs = Math.max(0, Math.min(3_600_000, Math.round(Number(body.elapsedMs) || 0)));
  const attempt = rows<any>(await db.from("ready_attempts").insert({ student_id: student.id, question_id: question.id, exam_id: examId, response, correct, elapsed_ms: elapsedMs }).select("id,correct,created_at").single());
  if (!correct) {
    const saved = await db.from("ready_question_bookmarks").upsert({ student_id: student.id, exam_id: examId, question_id: question.id, source: "wrong_answer", updated_at: new Date().toISOString() }, { onConflict: "student_id,exam_id,question_id", ignoreDuplicates: false });
    if (saved.error) throw new ApiError(500, saved.error.message);
  }
  const bookmark = await db.from("ready_question_bookmarks").select("question_id").eq("student_id", student.id).eq("exam_id", examId).eq("question_id", question.id).maybeSingle();
  if (bookmark.error) throw new ApiError(500, bookmark.error.message);
  const explanation = clean(question.payload?.explanation, 4_000);
  return { attempt, correct, answer: correct ? null : answer, explanation, aiFeedback, aiRequestId, bookmarked: !!bookmark.data, reviewCount: (await eligibleReviewQuestionIds(student.id, examId)).length + await workbookReviewCount(student.id, examId) };
}

function codeWorkbookForPassage(passage: any) {
  const identity = [passage?.title, passage?.source_label].map(value => clean(value, 300)).join(" ");
  const lesson = /(?:Lesson|레슨|제)\s*4|4\s*과/i.test(identity) ? 4 : /(?:Lesson|레슨|제)\s*2|2\s*과/i.test(identity) ? 2 : /(?:Lesson|레슨|제)\s*1|1\s*과/i.test(identity) ? 1 : 0;
  if(/(?:민병천|NE\s*능률|NE\s*\()/i.test(identity))return lesson===2?NE_MINBYEONGCHEON_L2_WORKBOOK:lesson===1?NE_MINBYEONGCHEON_L1_WORKBOOK:null;
  if(/(?:박준언|YBM)/i.test(identity))return lesson===2?YBM_PARKJUNEON_L2_WORKBOOK:lesson===1?YBM_PARKJUNEON_L1_WORKBOOK:null;
  if(/(?:동아|이병민)/i.test(identity))return lesson===4?DONGA_LEEBYEONGMIN_L4_WORKBOOK:null;
  return null;
}
async function workbookForPassage(passage: any) {
  const codeCatalog = codeWorkbookForPassage(passage); if (codeCatalog) return codeCatalog;
  if (!clean(passage?.id, 80)) return null;
  const result = await db.from("ready_workbook_catalogs").select("catalog").eq("passage_id", passage.id).maybeSingle();
  if (result.error) throw new ApiError(500, result.error.message);
  return result.data?.catalog || null;
}
function workbookItem(catalog: any, itemKey: string) {
  return catalog?.stages?.flatMap((stage: any) => stage.items || []).find((item: any) => item.key === itemKey) || null;
}
async function workbookReviewCount(studentId: string, examId: string) {
  const result = await db.from("ready_workbook_bookmarks").select("item_key", { count: "exact", head: true }).eq("student_id", studentId).eq("exam_id", examId);
  if (result.error) throw new ApiError(500, result.error.message);
  return result.count || 0;
}
async function workbookReviewItems(studentId: string, examId: string) {
  const bookmarks = rows<any[]>(await db.from("ready_workbook_bookmarks").select("passage_id,workbook_key,item_key,item_type,source,updated_at").eq("student_id", studentId).eq("exam_id", examId).order("updated_at", { ascending: false }));
  if (!bookmarks.length) return [];
  const passageIds = [...new Set(bookmarks.map(bookmark => bookmark.passage_id))], passages = rows<any[]>(await db.from("ready_passages").select("id,title,source_label").in("id", passageIds));
  const byPassage = new Map(passages.map(passage => [passage.id, passage]));
  const attempts = rows<any[]>(await db.from("ready_workbook_attempts").select("passage_id,item_key,correct,created_at").eq("student_id", studentId).eq("exam_id", examId).order("created_at", { ascending: false })), latest = new Map<string, boolean>();
  for (const attempt of attempts) { const key = `${attempt.passage_id}:${attempt.item_key}`; if (!latest.has(key)) latest.set(key, attempt.correct === true); }
  const output:any[]=[];
  for (const bookmark of bookmarks) {
    const passage = byPassage.get(bookmark.passage_id), catalog = await workbookForPassage(passage), item = workbookItem(catalog, bookmark.item_key);
    if (passage && catalog && item && catalog.workbookKey === bookmark.workbook_key) output.push({ passageId: passage.id, passageTitle: passage.title, workbookKey: catalog.workbookKey, workbookTitle: catalog.title, itemKey: item.key, stage: item.stage, number: item.number, kind: item.kind, title: catalog.stages.find((stage: any) => stage.stage === item.stage)?.title || `${item.stage}단계`, bookmarked: true, bookmarkSource: bookmark.source, lastResult: latest.get(`${passage.id}:${item.key}`) ?? null });
  }
  return output;
}
async function studentWorkbook(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), passageId = required(body.passageId, "지문", 80);
  const passage = await studentPassageAccess(examId, passageId, student), catalog = await workbookForPassage(passage);
  if (!catalog) throw new ApiError(404, "이 지문에는 아직 READY 워크북이 없습니다.");
  const attempts = rows<any[]>(await db.from("ready_workbook_attempts").select("item_key,correct,created_at").eq("student_id", student.id).eq("exam_id", examId).eq("passage_id", passageId).eq("workbook_key", catalog.workbookKey).order("created_at", { ascending: false }));
  const bookmarkRows = rows<any[]>(await db.from("ready_workbook_bookmarks").select("item_key").eq("student_id", student.id).eq("exam_id", examId).eq("passage_id", passageId).eq("workbook_key", catalog.workbookKey)), bookmarks = new Set(bookmarkRows.map(row => row.item_key));
  const latest = new Map<string, boolean>();
  for (const attempt of attempts) if (!latest.has(attempt.item_key)) latest.set(attempt.item_key, attempt.correct === true);
  const stages = catalog.stages.map((stage: any) => ({
    stage: stage.stage, title: stage.title, instruction: stage.instruction,
    locked: false, lockReason: "",
    total: stage.items.length,
    attempted: stage.items.filter((item: any) => latest.has(item.key)).length,
    completed: stage.items.filter((item: any) => latest.get(item.key) === true).length,
    items: stage.items.map((item: any) => ({
      key: item.key, stage: item.stage, number: item.number, kind: item.kind || "blank_input",
      source: item.source, prompt: item.prompt, slotCount: item.answers.length,
      hints: Array.isArray(item.hints) ? item.hints : [],
      groups: Array.isArray(item.groups) ? item.groups : [],
      wordBank: Array.isArray(item.wordBank) ? item.wordBank : [],
      pairCount: Number(item.pairCount) || 0, subtype: clean(item.subtype, 40),
      assistance: workbookAssistanceMode(item),
      grading: item.kind === "translation_ai" ? { mode: "ai" } : { mode: "deterministic", answers: item.answers },
      completed: latest.get(item.key) === true, lastResult: latest.get(item.key) ?? null, bookmarked: bookmarks.has(item.key),
    })),
  }));
  const savedWords=await savedWordList(student.id,examId);
  return { workbookKey: catalog.workbookKey, title: catalog.title, passage: { id: passage.id, title: passage.title, updated_at: passage.updated_at }, savedWords, stages };
}

async function workbookAssistance(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), passageId = required(body.passageId, "지문", 80), itemKey = required(body.itemKey, "워크북 문제", 120);
  const passage = await studentPassageAccess(examId, passageId, student), catalog = await workbookForPassage(passage), item = workbookItem(catalog, itemKey);
  if (!catalog || !item || !workbookAssistanceMode(item)) throw new ApiError(404, "현재 검증 계약이 필요하지 않은 문제입니다.");
  return { itemKey, assistance: await publicWorkbookAssistance(item, sha256Hex) };
}

function hintReceiptSecret() { return `${supabaseAdminKey()}:ready-workbook-hint-v1`; }
function base64UrlText(value: string) { let binary = ""; for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function decodeBase64UrlText(value: string) { const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4)), bytes = Uint8Array.from(binary, character => character.charCodeAt(0)); return new TextDecoder().decode(bytes); }
async function signHintReceipt(payload: any) { const encoded = base64UrlText(JSON.stringify(payload)); return `${encoded}.${await sha256Hex(`${hintReceiptSecret()}:${encoded}`)}`; }
async function verifyHintReceipt(token: unknown, expected: any) {
  const [encoded, signature] = clean(token, 4_000).split(".");
  if (!encoded || !signature || !secureEqual(signature, await sha256Hex(`${hintReceiptSecret()}:${encoded}`))) return null;
  try { const value = JSON.parse(decodeBase64UrlText(encoded)); return value.studentId === expected.studentId && value.examId === expected.examId && value.passageId === expected.passageId && value.itemKey === expected.itemKey ? value : null; } catch { return null; }
}

async function workbookHint(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), passageId = required(body.passageId, "지문", 80), itemKey = required(body.itemKey, "워크북 문제", 120);
  const passage = await studentPassageAccess(examId, passageId, student), catalog = await workbookForPassage(passage), item = workbookItem(catalog, itemKey);
  const requestedSlots:number[] = [...new Set<number>((Array.isArray(body.slots) ? body.slots : [body.slot]).map((value:unknown)=>Number(value)).filter((slot:number) => Number.isInteger(slot) && slot >= 0 && slot < (item?.answers?.length || 0)))];
  if (!catalog || !item || Number(item.stage) !== 9 || !requestedSlots.length) throw new ApiError(404, "현재 힌트를 제공할 수 없는 빈칸입니다.");
  const identity = { studentId: student.id, examId, passageId, itemKey }, prior = body.hintReceipt ? await verifyHintReceipt(body.hintReceipt, identity) : null;
  if (body.hintReceipt && !prior) throw new ApiError(400, "힌트 상태를 다시 시작해 주세요.");
  const hintCount = 1, usedFullAnswerHint = false;
  const hintReceipt = await signHintReceipt({ ...identity, hintCount, usedFullAnswerHint, issuedAt: new Date().toISOString() });
  return { fragments: requestedSlots.map(slot => ({ slot, fragment: stageNineHint(item.answers[slot]) })), hintCount, usedFullAnswerHint, hintReceipt };
}
async function setWorkbookBookmark(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), passageId = required(body.passageId, "지문", 80), itemKey = required(body.itemKey, "워크북 문제", 120), bookmarked = body.bookmarked === true;
  const passage = await studentPassageAccess(examId, passageId, student), catalog = await workbookForPassage(passage), item = workbookItem(catalog, itemKey);
  if (!catalog || !item) throw new ApiError(404, "현재 저장할 수 없는 워크북 문제입니다.");
  if (bookmarked) {
    const saved = await db.from("ready_workbook_bookmarks").upsert({ student_id: student.id, exam_id: examId, passage_id: passageId, workbook_key: catalog.workbookKey, item_key: item.key, item_type: item.kind, source: "manual", updated_at: new Date().toISOString() }, { onConflict: "student_id,exam_id,passage_id,workbook_key,item_key" });
    if (saved.error) throw new ApiError(500, saved.error.message);
  } else {
    const removed = await db.from("ready_workbook_bookmarks").delete().eq("student_id", student.id).eq("exam_id", examId).eq("passage_id", passageId).eq("workbook_key", catalog.workbookKey).eq("item_key", item.key);
    if (removed.error) throw new ApiError(500, removed.error.message);
  }
  return { bookmarked, reviewCount: (await eligibleReviewQuestionIds(student.id, examId)).length + await workbookReviewCount(student.id, examId) };
}
async function submitWorkbookAttempt(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), passageId = required(body.passageId, "지문", 80), itemKey = required(body.itemKey, "워크북 문제", 120);
  const passage = await studentPassageAccess(examId, passageId, student), catalog = await workbookForPassage(passage), item = workbookItem(catalog, itemKey);
  if (!catalog || !item) throw new ApiError(404, "현재 풀 수 없는 워크북 문제입니다.");
  const revealedAnswer = body.revealAnswer === true, rawResponses = Array.isArray(body.responses) ? body.responses : [];
  const responses = revealedAnswer ? Array.from({ length: item.answers.length }, (_, index) => clean(rawResponses[index], 1_000)) : cleanList(rawResponses, 80, 1_000);
  if (!revealedAnswer && responses.length !== item.answers.length) throw new ApiError(400, "모든 빈칸을 입력해 주세요.");
  let slotResults = responses.map((response, index) => !!response && normalizeWorkbookAnswer(response) === normalizeWorkbookAnswer(item.answers[index])), correct = !revealedAnswer && slotResults.every(Boolean), aiFeedback = "", aiFeedbackLines: string[] = [], aiScore: number | null = null, gradingPolicy: string | null = null, aiRequestId: string | null = null;
  let hintCount = 0, usedFullAnswerHint = false, completedAfterHint = false;
  if (Number(item.stage) === 9 && body.hintReceipt) {
    const hintState = await verifyHintReceipt(body.hintReceipt, { studentId: student.id, examId, passageId, itemKey });
    if (!hintState) throw new ApiError(400, "힌트 상태를 확인할 수 없습니다. 다시 시도해 주세요.");
    hintCount = Math.min(2, Math.max(0, Number(hintState.hintCount) || 0));
    usedFullAnswerHint = revealedAnswer || hintState.usedFullAnswerHint === true || hintCount >= 2;
    completedAfterHint = correct && usedFullAnswerHint;
    if (usedFullAnswerHint) correct = false;
  }
  if(item.kind==="translation_ai"&&!revealedAnswer){
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const used = await db.from("ready_workbook_ai_grading_requests").select("id", { count: "exact", head: true }).eq("student_id", student.id).gte("created_at", today.toISOString());
    if (used.error) throw new ApiError(500, used.error.message);
    if ((used.count || 0) >= AI_GRADING_DAILY_LIMIT) throw new ApiError(429, `오늘 AI 채점 ${AI_GRADING_DAILY_LIMIT}회를 모두 사용했습니다.`);
    const rubricSnapshot = { sourceEnglish: item.source, publisherReferenceTranslation: item.answers[0], graderModel: GEMINI_MODEL, gradingPolicy: WORKBOOK_TRANSLATION_GRADING_POLICY.version, passScore: WORKBOOK_TRANSLATION_GRADING_POLICY.passScore, rubric: WORKBOOK_TRANSLATION_GRADING_POLICY.rubric };
    const pending = rows<any>(await db.from("ready_workbook_ai_grading_requests").insert({ student_id: student.id, exam_id: examId, passage_id: passageId, workbook_key: catalog.workbookKey, item_key: item.key, response: { responses }, rubric_snapshot: rubricSnapshot, status: "pending" }).select("id").single());
    aiRequestId = pending.id;
    try {
      const grade=await callGeminiTranslationGrade(item,responses[0]);
      aiScore=grade.score;gradingPolicy=WORKBOOK_TRANSLATION_GRADING_POLICY.version;correct=workbookTranslationPass(grade.score,grade.criticalErrors);slotResults=[correct];aiFeedbackLines=grade.feedbackLines;aiFeedback=grade.feedbackLines.join(" ");
      const completed = await db.from("ready_workbook_ai_grading_requests").update({ status: "completed", result: { score: grade.score, correct, critical_errors: grade.criticalErrors, feedback_lines: grade.feedbackLines, error_tags: grade.errorTags, grader_model: GEMINI_MODEL, grading_policy: WORKBOOK_TRANSLATION_GRADING_POLICY.version, pass_score: WORKBOOK_TRANSLATION_GRADING_POLICY.passScore }, completed_at: new Date().toISOString() }).eq("id", aiRequestId).eq("status", "pending");
      if (completed.error) throw new ApiError(500, completed.error.message);
    } catch (error) {
      await db.from("ready_workbook_ai_grading_requests").update({ status: "failed", error_code: error instanceof ApiError ? `http_${error.status}` : "unknown", completed_at: new Date().toISOString() }).eq("id", aiRequestId).eq("status", "pending");
      throw error;
    }
  }
  const inserted = rows<any>(await db.from("ready_workbook_attempts").insert({
    student_id: student.id, exam_id: examId, passage_id: passageId, workbook_key: catalog.workbookKey,
    item_key: item.key, stage: item.stage, response: { responses, revealedAnswer }, correct, ai_grading_request_id: aiRequestId,
    hint_count: hintCount, used_full_answer_hint: usedFullAnswerHint, completed_after_hint: completedAfterHint,
  }).select("id,correct,created_at").single());
  if (!correct) {
    const saved = await db.from("ready_workbook_bookmarks").upsert({ student_id: student.id, exam_id: examId, passage_id: passageId, workbook_key: catalog.workbookKey, item_key: item.key, item_type: item.kind, source: "wrong_answer", updated_at: new Date().toISOString() }, { onConflict: "student_id,exam_id,passage_id,workbook_key,item_key", ignoreDuplicates: true });
    if (saved.error) throw new ApiError(500, saved.error.message);
  } else {
    const resolved = await db.from("ready_workbook_bookmarks").delete().eq("student_id", student.id).eq("exam_id", examId).eq("passage_id", passageId).eq("workbook_key", catalog.workbookKey).eq("item_key", item.key).eq("source", "wrong_answer");
    if (resolved.error) throw new ApiError(500, resolved.error.message);
  }
  const bookmark = await db.from("ready_workbook_bookmarks").select("item_key").eq("student_id", student.id).eq("exam_id", examId).eq("passage_id", passageId).eq("workbook_key", catalog.workbookKey).eq("item_key", item.key).maybeSingle();
  if (bookmark.error) throw new ApiError(500, bookmark.error.message);
  return { attempt: inserted, correct, revealedAnswer, answers: correct ? [] : item.answers, slotResults, aiFeedback, aiFeedbackLines, aiScore, gradingPolicy, aiRequestId, hintCount, usedFullAnswerHint, completedAfterHint, bookmarked: !!bookmark.data, reviewCount: (await eligibleReviewQuestionIds(student.id, examId)).length + await workbookReviewCount(student.id, examId) };
}
function normalizedWord(value: unknown) { return clean(value, 100).toLowerCase().replace(/[^a-z']/g, "").replace(/^'+|'+$/g, ""); }
async function studyContext(body: any, session: ReadySession, sentenceRequired = false) { const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), passageId = required(body.passageId, "지문", 80), passage = await studentPassageAccess(examId, passageId, student), sentenceId = clean(body.sentenceId, 80); let sentence:any = null; if (sentenceRequired || sentenceId) { sentence = rows<any>(await db.from("ready_passage_sentences").select("id,sentence_index,text,translation").eq("id", required(sentenceId, "문장", 80)).eq("passage_id", passage.id).single()); } return { student, examId, passage, sentence }; }
async function wordLookupContext(body:any,session:ReadySession){
  const surfaceKind=clean(body.surfaceKind,20)||"reader";
  if(surfaceKind==="reader"){
    const context=await studyContext(body,session,true);
    return {...context,surfaceKind,surfaceKey:clean(body.surfaceKey,160)||`sentence:${context.sentence.id}`,sentence:{...context.sentence,id:clean(body.sentenceId,160)}};
  }
  const student=await studentForSession(session),examId=required(body.examId,"Exam",80),passageId=required(body.passageId,"지문",80),passage=await studentPassageAccess(examId,passageId,student),surfaceKey=required(body.surfaceKey,"조회 위치",160);
  if(surfaceKind==="question"){
    const questionId=required(body.questionId,"문제",80),question=rows<any>(await db.from("ready_questions").select("id,passage_id,type,payload,status").eq("id",questionId).eq("passage_id",passageId).eq("status","available").maybeSingle());
    if(!question||!isReadyQuestion(question))throw new ApiError(404,"현재 단어를 조회할 수 없는 문제입니다.");
    const attempted=await db.from("ready_attempts").select("id").eq("student_id",student.id).eq("exam_id",examId).eq("question_id",questionId).limit(1).maybeSingle();if(attempted.error)throw new ApiError(500,attempted.error.message);if(!attempted.data)throw new ApiError(403,"문제를 제출한 뒤 단어 뜻을 볼 수 있습니다.");
    const sentenceRows=rows<any[]>(await db.from("ready_passage_sentences").select("id,sentence_index,text,translation").eq("passage_id",passageId).order("sentence_index")),spec=publicQuestion(question,sentenceRows.map(item=>item.text).join(" ")),segments=spec.interactionContract?.passage?.segments||[];let text="";
    if(surfaceKey==="prompt")text=spec.prompt;
    else if(surfaceKey.startsWith("passage:")){const index=Number(surfaceKey.split(":")[1]),segment=segments[index];if(segment&&["text","annotation"].includes(segment.kind))text=clean(segment.text,10_000);}
    else if(surfaceKey.startsWith("choice:")){const [,rowText,cellText]=surfaceKey.split(":"),row=Number(rowText),cell=Number(cellText);text=clean(spec.interactionContract?.choices?.rows?.[row]?.cells?.[cell],2_000);}
    if(!text)throw new ApiError(404,"이 문제 영역에서는 단어 뜻을 볼 수 없습니다.");
    const publisher=sentenceRows.find(item=>item.text.includes(text)||text.includes(item.text));
    return {student,examId,passage,surfaceKind,surfaceKey,sentence:{id:clean(body.sentenceId,160),text,translation:clean(publisher?.translation,2_000),sentence_index:publisher?.sentence_index??null,dbSentenceId:publisher?.id||null},questionId};
  }
  if(surfaceKind==="workbook"){
    const itemKey=required(body.workbookItemKey,"워크북 문제",120),catalog=await workbookForPassage(passage),item=workbookItem(catalog,itemKey);if(!catalog||!item)throw new ApiError(404,"현재 단어를 조회할 수 없는 워크북 문제입니다.");
    const attempted=await db.from("ready_workbook_attempts").select("id").eq("student_id",student.id).eq("exam_id",examId).eq("passage_id",passageId).eq("workbook_key",catalog.workbookKey).eq("item_key",itemKey).limit(1).maybeSingle();if(attempted.error)throw new ApiError(500,attempted.error.message);if(!attempted.data)throw new ApiError(403,"워크북을 제출한 뒤 단어 뜻을 볼 수 있습니다.");
    let text="";if(surfaceKey==="source")text=clean(item.source,10_000);else if(surfaceKey.startsWith("prompt")){const canonical=clean(item.prompt,10_000),partIndex=Number(surfaceKey.split(":")[1]),parts=canonical.split(/_{5,}|⟦(?:CHOICE|ORDER):\d+⟧/);text=Number.isInteger(partIndex)&&parts[partIndex]!==undefined?parts[partIndex]:canonical;}if(!text||!/[A-Za-z]/.test(text))throw new ApiError(404,"이 워크북 영역에서는 단어 뜻을 볼 수 없습니다.");
    const translation=/[가-힣]/.test(clean(item.source,10_000))?clean(item.source,2_000):(item.kind==="translation_ai"?clean(item.answers?.[0],2_000):"");
    return {student,examId,passage,surfaceKind,surfaceKey,sentence:{id:clean(body.sentenceId,160),text,translation,sentence_index:null,dbSentenceId:null},workbookItemKey:itemKey};
  }
  throw new ApiError(400,"지원하지 않는 단어 조회 화면입니다.");
}
async function progressSavedWordMemory(saved:any,context:any,root:string,occurrenceKey:string,resolved:boolean,retry:boolean){
  if(!saved||!resolved||retry||occurrenceKey===saved.origin_occurrence_key)return saved;
  const history=await db.from("ready_word_lookup_events").select("occurrence_key").eq("student_id",context.student.id).eq("exam_id",context.examId).eq("normalized_word",root).eq("resolved",true).eq("lookup_reason","initial").gte("created_at",saved.created_at);
  if(history.error)throw new ApiError(500,history.error.message);
  const distinct=new Set((history.data||[]).map(item=>item.occurrence_key).filter(key=>key&&key!==saved.origin_occurrence_key)),memoryLevel=Math.min(3,1+distinct.size);
  if(memoryLevel===Number(saved.memory_level))return saved;
  const updated=await db.from("ready_saved_words").update({memory_level:memoryLevel,updated_at:new Date().toISOString()}).eq("id",saved.id).select("id,meaning_snapshot,memory_level,origin_occurrence_key,created_at").single();
  if(updated.error)throw new ApiError(500,updated.error.message);
  return rows<any>(updated);
}
async function readerInlineGloss(body:any,session:ReadySession){
  const context=await wordLookupContext(body,session),sentence=String(context.sentence.text||""),start=Number(body.start),end=Number(body.end),surfaceText=required(body.sourceText,"선택 단어",100),requestedRevision=clean(body.passageRevision,100);
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>sentence.length||sentence.slice(start,end)!==surfaceText)throw new ApiError(400,"선택한 단어 범위가 현재 문장과 맞지 않습니다.");
  if(context.surfaceKind==="reader"&&requestedRevision&&requestedRevision!==clean(context.passage.updated_at,100))throw new ApiError(409,"지문이 수정되었습니다. 다시 열어 주세요.");
  if(!/^[A-Za-z]+(?:[’'][A-Za-z]+)*$/.test(surfaceText))throw new ApiError(400,"영어 단어만 뜻을 볼 수 있습니다.");
  const today=new Date();today.setHours(0,0,0,0);const used=await db.from("ready_word_lookup_events").select("id",{count:"exact",head:true}).eq("student_id",context.student.id).gte("created_at",today.toISOString());if(used.error)throw new ApiError(500,used.error.message);if((used.count||0)>=AI_DAILY_LIMIT)throw new ApiError(429,`오늘 Gemini 문맥 뜻풀이 ${AI_DAILY_LIMIT}회를 모두 사용했습니다.`);
  const root=lemma(surfaceText),savedResult=await db.from("ready_saved_words").select("id,meaning_snapshot,memory_level,origin_occurrence_key,created_at").eq("student_id",context.student.id).eq("exam_id",context.examId).eq("normalized_word",root).maybeSingle();if(savedResult.error)throw new ApiError(500,savedResult.error.message);let saved:any=savedResult.data,occurrenceKey=[context.surfaceKind,context.passage.id,context.surfaceKey,context.sentence.id,start,end,clean(context.passage.updated_at,100)||"current"].join(":");
  if(saved&&!body.retry){
    const meaning=clean(saved.meaning_snapshot,60),fastEvent=await db.from("ready_word_lookup_events").insert({student_id:context.student.id,exam_id:context.examId,passage_id:context.passage.id,sentence_id:context.sentence.dbSentenceId||((context.surfaceKind==="reader")?context.sentence.id:null),surface_word:surfaceText,normalized_word:root,source_text_snapshot:surfaceText,start_offset:start,end_offset:end,meaning_snapshot:meaning,lemma_snapshot:root,lookup_kind:"word",confidence:1,passage_revision:context.passage.updated_at,occurrence_key:occurrenceKey,english_sentence_snapshot:sentence,publisher_translation_snapshot:clean(context.sentence.translation,2_000),lookup_reason:"initial",resolved:true,source_kind:context.surfaceKind,source_key:context.surfaceKey}).select("id").single();
    if(fastEvent.error)throw new ApiError(500,fastEvent.error.message);
    saved=await progressSavedWordMemory(saved,context,root,occurrenceKey,true,false);
    return {resolved:true,eventId:fastEvent.data.id,sentenceId:context.sentence.id,start,end,sourceText:surfaceText,meaning,lemma:root,kind:"word",confidence:1,occurrenceKey,saved:true,savedWordId:saved.id,savedMeaning:meaning,memoryLevel:Number(saved.memory_level)||1,fastPath:true};
  }
  const promptContext:ReaderGlossPromptContext={clicked:surfaceText,lemma:root,sentence,translation:clean(context.sentence.translation,2_000),savedMeaning:clean(saved?.meaning_snapshot,60),previousMeaning:body.retry?clean(body.previousMeaning,60):"",retry:body.retry===true};
  const ai=await callGeminiInlineGloss(promptContext),confidence=Math.max(0,Math.min(1,Number(ai.confidence)||0)),meaning=clean(ai.meaning,60),sourceSpan=clean(ai.source_span,180),requestedKind=clean(ai.kind,12);let resolvedStart=start,resolvedEnd=end,kind:"word"|"phrase"="word",spanValidated=false;
  if(sourceSpan){const folded=sentence.toLocaleLowerCase(),needle=sourceSpan.toLocaleLowerCase(),matches=[];let offset=0;while((offset=folded.indexOf(needle,offset))>=0){const spanEnd=offset+sourceSpan.length;if(offset<=start&&spanEnd>=end)matches.push({start:offset,end:spanEnd});offset+=Math.max(1,needle.length);}if(matches.length===1){resolvedStart=matches[0].start;resolvedEnd=matches[0].end;const expanded=resolvedStart!==start||resolvedEnd!==end,tokenCount=(sourceSpan.match(/[A-Za-z]+(?:[’'][A-Za-z]+)*/g)||[]).length;spanValidated=expanded?requestedKind==="phrase"&&tokenCount>=2&&tokenCount<=5&&!/[.!?;:]/.test(sourceSpan):requestedKind==="word";kind=expanded?"phrase":"word";}}
  const resolved=confidence>=0.65&&spanValidated&&!!meaning,sourceText=sentence.slice(resolvedStart,resolvedEnd),eventResult=await db.from("ready_word_lookup_events").insert({student_id:context.student.id,exam_id:context.examId,passage_id:context.passage.id,sentence_id:context.sentence.dbSentenceId||((context.surfaceKind==="reader")?context.sentence.id:null),surface_word:surfaceText,normalized_word:root,source_text_snapshot:resolved?sourceText:surfaceText,start_offset:resolved?resolvedStart:start,end_offset:resolved?resolvedEnd:end,meaning_snapshot:resolved?meaning:null,lemma_snapshot:root,lookup_kind:resolved?kind:"word",confidence,passage_revision:context.passage.updated_at,occurrence_key:occurrenceKey,english_sentence_snapshot:sentence,publisher_translation_snapshot:clean(context.sentence.translation,2_000),lookup_reason:body.retry?"retry":"initial",resolved,source_kind:context.surfaceKind,source_key:context.surfaceKey}).select("id").single();if(eventResult.error)throw new ApiError(500,eventResult.error.message);const event=rows<any>(eventResult);
  saved=await progressSavedWordMemory(saved,context,root,occurrenceKey,resolved,body.retry===true);
  return resolved?{resolved:true,eventId:event.id,sentenceId:context.sentence.id,start:resolvedStart,end:resolvedEnd,sourceText,meaning,lemma:root,kind,confidence,occurrenceKey,saved:!!saved,savedWordId:saved?.id||null,savedMeaning:clean(saved?.meaning_snapshot,60),memoryLevel:saved?Number(saved.memory_level)||1:0}:{resolved:false,eventId:event.id,sentenceId:context.sentence.id,start,end,sourceText:surfaceText,lemma:root,confidence,saved:!!saved,savedWordId:saved?.id||null,savedMeaning:clean(saved?.meaning_snapshot,60),memoryLevel:saved?Number(saved.memory_level)||1:0};
}
function meaningKey(value: string) { return clean(value, 500).toLowerCase().replace(/\s+/g, " "); }
async function saveReaderWord(body:any,session:ReadySession){
  const student=await studentForSession(session),examId=required(body.examId,"Exam",80),eventId=required(body.eventId,"조회 기록",80);await studentExamAccess(examId,student);
  const eventResult=await db.from("ready_word_lookup_events").select("id,passage_id,sentence_id,surface_word,normalized_word,meaning_snapshot,occurrence_key,resolved").eq("id",eventId).eq("student_id",student.id).eq("exam_id",examId).maybeSingle();if(eventResult.error)throw new ApiError(500,eventResult.error.message);const event:any=eventResult.data;if(!event?.resolved||!event.meaning_snapshot)throw new ApiError(400,"확인된 단어 뜻만 저장할 수 있습니다.");
  const meaning=clean(event.meaning_snapshot,60),key=meaningKey(meaning),existing=await db.from("ready_saved_words").select("id,memory_level").eq("student_id",student.id).eq("exam_id",examId).eq("normalized_word",event.normalized_word).maybeSingle();if(existing.error)throw new ApiError(500,existing.error.message);let parent:any=existing.data;
  if(!parent){const inserted=await db.from("ready_saved_words").insert({student_id:student.id,exam_id:examId,passage_id:event.passage_id,sentence_id:event.sentence_id,word:event.surface_word,normalized_word:event.normalized_word,meaning_snapshot:meaning,meaning_key:key,memory_level:1,origin_occurrence_key:event.occurrence_key}).select("id,memory_level").single();if(inserted.error)throw new ApiError(500,inserted.error.message);parent=inserted.data;}
  const sense=await db.from("ready_saved_word_senses").upsert({saved_word_id:parent.id,meaning,meaning_key:key,origin_event_id:event.id,origin_occurrence_key:event.occurrence_key,updated_at:new Date().toISOString()},{onConflict:"saved_word_id,meaning_key",ignoreDuplicates:false}).select("id").maybeSingle();if(sense.error)throw new ApiError(500,sense.error.message);
  const updated=await db.from("ready_saved_words").update({meaning_snapshot:meaning,meaning_key:key,word:event.surface_word,passage_id:event.passage_id,sentence_id:event.sentence_id,updated_at:new Date().toISOString()}).eq("id",parent.id).select("id,normalized_word,memory_level").single();if(updated.error)throw new ApiError(500,updated.error.message);
  const senses=await db.from("ready_saved_word_senses").select("id,meaning,origin_occurrence_key").eq("saved_word_id",parent.id).order("created_at",{ascending:false});if(senses.error)throw new ApiError(500,senses.error.message);return {saved:true,savedWordId:updated.data.id,lemma:updated.data.normalized_word,meaning,memoryLevel:Number(updated.data.memory_level)||1,senses:rows<any[]>(senses).map(item=>({id:item.id,meaning:item.meaning,occurrenceKey:item.origin_occurrence_key||null}))};
}
async function removeReaderWord(body:any,session:ReadySession){const student=await studentForSession(session),examId=required(body.examId,"Exam",80),root=lemma(normalizedWord(required(body.lemma,"단어",100)));await studentExamAccess(examId,student);const removed=await db.from("ready_saved_words").delete().eq("student_id",student.id).eq("exam_id",examId).eq("normalized_word",root).select("id");if(removed.error)throw new ApiError(500,removed.error.message);return {saved:false,lemma:root,memoryLevel:0,removed:(removed.data||[]).length};}
async function updateReaderWordMeaning(body:any,session:ReadySession){const student=await studentForSession(session),examId=required(body.examId,"Exam",80),savedWordId=required(body.savedWordId,"저장 단어",80),meaning=required(body.meaning,"저장 뜻",60);await studentExamAccess(examId,student);const updated=await db.from("ready_saved_words").update({meaning_snapshot:meaning,meaning_key:meaningKey(meaning),updated_at:new Date().toISOString()}).eq("id",savedWordId).eq("student_id",student.id).eq("exam_id",examId).select("id,normalized_word,meaning_snapshot,memory_level").maybeSingle();if(updated.error)throw new ApiError(500,updated.error.message);if(!updated.data)throw new ApiError(404,"저장 단어를 찾지 못했습니다.");return {savedWordId:updated.data.id,lemma:updated.data.normalized_word,meaning:updated.data.meaning_snapshot,memoryLevel:Number(updated.data.memory_level)||1};}
async function saveWord(body:any,session:ReadySession){const context=await studyContext(body,session),word=required(body.word,"단어",100),normalized=normalizedWord(body.normalizedWord||word),root=lemma(normalized),meaning=required(body.meaning,"선택한 뜻",500);if(!root)throw new ApiError(400,"영어 단어만 저장할 수 있습니다.");const known=await db.from("ready_word_states").select("known").eq("student_id",context.student.id).eq("passage_id",context.passage.id).eq("normalized_word",root).maybeSingle();if(known.error)throw new ApiError(500,known.error.message);if(known.data?.known)throw new ApiError(409,"아는 단어로 표시했습니다. 다시 학습하기를 누른 뒤 저장할 수 있습니다.");const saved=await db.from("ready_saved_words").upsert({student_id:context.student.id,passage_id:context.passage.id,sentence_id:context.sentence?.id||null,word,normalized_word:root,meaning_snapshot:meaning,meaning_key:meaningKey(meaning)},{onConflict:"student_id,passage_id,normalized_word,meaning_key",ignoreDuplicates:true}).select("id,meaning_snapshot").maybeSingle();if(saved.error)throw new ApiError(500,saved.error.message);return {saved:true,normalizedWord:root,meaning};}
async function setWordKnown(body:any,session:ReadySession,known:boolean){const context=await studyContext(body,session),root=lemma(normalizedWord(required(body.normalizedWord||body.word,"단어",100)));if(!root)throw new ApiError(400,"영어 단어만 처리할 수 있습니다.");const result=await db.rpc("ready_set_word_known",{p_student_id:context.student.id,p_passage_id:context.passage.id,p_normalized_word:root,p_known:known});if(result.error)throw new ApiError(500,result.error.message);return {known,normalizedWord:root};}
async function deleteSavedWord(body:any,session:ReadySession){const student=await studentForSession(session),savedWordId=required(body.savedWordId,"저장 단어",80),result=await db.from("ready_saved_words").delete().eq("id",savedWordId).eq("student_id",student.id).select("id,normalized_word").maybeSingle();if(result.error)throw new ApiError(500,result.error.message);if(!result.data)throw new ApiError(404,"저장 단어를 찾지 못했습니다.");return {deleted:result.data.id,normalizedWord:result.data.normalized_word};}
async function translationView(body: any, session: ReadySession) { const context = await studyContext(body, session, true); const event = await db.from("ready_sentence_translation_view_events").insert({ student_id: context.student.id, exam_id: context.examId, passage_id: context.passage.id, sentence_id: context.sentence.id }); if (event.error) throw new ApiError(500, event.error.message); return { recorded:true }; }
const SENTENCE_PROMPT_VERSION="easy-v1",STRUCTURE_PROMPT_VERSION="structure-v1";
async function readerSentenceContext(body:any,session:ReadySession){const student=await studentForSession(session),examId=required(body.examId,"Exam",80),passageId=required(body.passageId,"지문",80),sentenceId=required(body.sentenceId,"문장",80),passage=await studentPassageAccess(examId,passageId,student),sentenceResult=await db.from("ready_passage_sentences").select("id,text,translation").eq("id",sentenceId).eq("passage_id",passageId).maybeSingle();if(sentenceResult.error)throw new ApiError(500,sentenceResult.error.message);if(!sentenceResult.data)throw new ApiError(404,"현재 지문의 문장을 찾지 못했습니다.");return {student,examId,passage,sentence:sentenceResult.data};}
async function geminiSentenceJson(prompt:string,maxOutputTokens=500){const provider=(Deno.env.get("AI_PROVIDER")??"").trim().toLowerCase(),key=Deno.env.get("GEMINI_API_KEY");if(provider!=="gemini"||!key)throw new ApiError(503,"Gemini 문장 학습 기능이 아직 연결되지 않았습니다.");let lastStatus=0,lastError="";for(const model of geminiModels()){const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({system_instruction:{parts:[{text:GEMINI_SYSTEM}]},contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{maxOutputTokens,temperature:0.1,responseMimeType:"application/json",thinkingConfig:{thinkingBudget:0}}})});if(response.ok){const payload=await response.json(),parsed=parseJson((payload?.candidates?.[0]?.content?.parts||[]).map((part:any)=>part?.text||"").join(""));if(!parsed)throw new ApiError(502,"Gemini 문장 학습 결과 형식이 올바르지 않습니다.");return parsed;}lastStatus=response.status;lastError=(await response.text()).slice(0,300);if(response.status!==429)break;}console.error("READY Gemini sentence failed:",lastStatus,lastError);throw new ApiError(lastStatus===429?429:502,lastStatus===429?"Gemini 문장 학습 한도를 모두 사용했습니다.":"Gemini 문장 학습 결과를 받을 수 없습니다.");}
async function sentenceCache(context:any,promptVersion:string){const sentenceHash=await sha256Hex(context.sentence.text),result=await db.from("ready_sentence_learning_cache").select("id,easy_translation,structure_chunks").eq("source_kind","reader").eq("source_key",context.sentence.id).eq("passage_revision",context.passage.updated_at).eq("sentence_hash",sentenceHash).eq("prompt_version",promptVersion).maybeSingle();if(result.error)throw new ApiError(500,result.error.message);return {row:result.data,sentenceHash};}
async function sentenceEasyTranslation(body:any,session:ReadySession){const context=await readerSentenceContext(body,session),cached=await sentenceCache(context,SENTENCE_PROMPT_VERSION);if(cached.row?.easy_translation)return {translation:cached.row.easy_translation,cached:true};const publisher=clean(context.sentence.translation,500);let translation=publisher,source="publisher_reference";if(!translation){const prompt=`한국 중고등학생이 바로 이해할 수 있는 쉬운 한국어로 다음 영어 한 문장만 번역하세요. 원문에 없는 의미를 더하지 마세요. JSON만 반환: {"translation":""}\n영문: ${context.sentence.text}`,result=await geminiSentenceJson(prompt,220);translation=clean(result.translation,500);source="gemini";}if(!translation)throw new ApiError(502,"쉬운 해석 결과가 비어 있습니다.");const saved=await db.from("ready_sentence_learning_cache").upsert({source_kind:"reader",source_key:context.sentence.id,passage_id:context.passage.id,sentence_id:context.sentence.id,passage_revision:context.passage.updated_at,sentence_hash:cached.sentenceHash,prompt_version:SENTENCE_PROMPT_VERSION,easy_translation:translation,updated_at:new Date().toISOString()},{onConflict:"source_kind,source_key,passage_revision,sentence_hash,prompt_version"});if(saved.error)throw new ApiError(500,saved.error.message);return {translation,cached:false,source};}
function validStructureChunks(chunks:any[],source:string){let cursor=0;if(!Array.isArray(chunks)||chunks.length<2||chunks.length>5)return false;for(const chunk of chunks){const english=clean(chunk?.english,300),korean=clean(chunk?.korean,300),role=clean(chunk?.role,160),at=source.indexOf(english,cursor);if(!english||!korean||!role||at<cursor)return false;cursor=at+english.length;}return cursor>0;}
async function sentenceStructure(body:any,session:ReadySession){const context=await readerSentenceContext(body,session),cached=await sentenceCache(context,STRUCTURE_PROMPT_VERSION);if(Array.isArray(cached.row?.structure_chunks))return {chunks:cached.row.structure_chunks,cached:true};const prompt=`다음 영어 문장을 원문 순서를 보존해 2~5개 의미 덩어리로 나누세요. 각 덩어리는 원문에 실제로 있는 연속 영어여야 하며 overlap하거나 새 영어를 만들면 안 됩니다. 각 덩어리에 끊어읽기 한국어와 짧은 역할 설명을 넣으세요. 문법 용어만 쓰지 마세요. JSON만 반환: {"chunks":[{"english":"","korean":"","role":""}]}\n영문: ${context.sentence.text}`,result=await geminiSentenceJson(prompt,700),chunks=Array.isArray(result.chunks)?result.chunks.map((chunk:any)=>({english:clean(chunk.english,300),korean:clean(chunk.korean,300),role:clean(chunk.role,160)})):[];if(!validStructureChunks(chunks,context.sentence.text))throw new ApiError(502,"문장 구조 결과를 검증하지 못했습니다.");const saved=await db.from("ready_sentence_learning_cache").upsert({source_kind:"reader",source_key:context.sentence.id,passage_id:context.passage.id,sentence_id:context.sentence.id,passage_revision:context.passage.updated_at,sentence_hash:cached.sentenceHash,prompt_version:STRUCTURE_PROMPT_VERSION,structure_chunks:chunks,updated_at:new Date().toISOString()},{onConflict:"source_kind,source_key,passage_revision,sentence_hash,prompt_version"});if(saved.error)throw new ApiError(500,saved.error.message);return {chunks,cached:false};}
async function saveSentence(body: any, session: ReadySession) { const context = await studyContext(body, session, true); const saved = await db.from("ready_saved_sentences").upsert({ student_id: context.student.id, exam_id: context.examId, passage_id: context.passage.id, sentence_id: context.sentence.id, source_text_snapshot: context.sentence.text, translation_snapshot: context.sentence.translation }, { onConflict: "student_id,sentence_id", ignoreDuplicates: true }).select().maybeSingle(); if (saved.error) throw new ApiError(500, saved.error.message); return { saved: true }; }
async function deleteSavedSentence(body:any,session:ReadySession){const student=await studentForSession(session),savedSentenceId=required(body.savedSentenceId,"저장 문장",80),result=await db.from("ready_saved_sentences").delete().eq("id",savedSentenceId).eq("student_id",student.id).select("id,sentence_id").maybeSingle();if(result.error)throw new ApiError(500,result.error.message);if(!result.data)throw new ApiError(404,"저장 문장을 찾지 못했습니다.");return {deleted:result.data.id,sentenceId:result.data.sentence_id};}
async function personalLibrary(_body:any,session:ReadySession){const student=await studentForSession(session),[words,sentences]=await Promise.all([
  db.from("ready_saved_words").select("id,word,normalized_word,meaning_snapshot,created_at,passage:ready_passages(title)").eq("student_id",student.id).order("created_at",{ascending:false}),
  db.from("ready_saved_sentences").select("id,sentence_id,source_text_snapshot,translation_snapshot,created_at,passage:ready_passages(title)").eq("student_id",student.id).order("created_at",{ascending:false})]);return {words:rows(words),sentences:rows(sentences)};}
async function dispatch(op: string, body: any, session: ReadySession | null) {
  switch (op) {
    case "student_login": return studentLogin(body); case "admin_login": return adminLogin(body); case "logout": return revokeSession(session as ReadySession);
    case "teacher_bootstrap": return teacherBootstrap(); case "delete_impact": return deleteImpact(body); case "create_student": return createStudent(body); case "set_student_code": return setStudentCode(body); case "delete_student": return deleteStudent(body);
    case "assign_scope_passages": return setScopePassages(body, false); case "set_scope_passages": return setScopePassages(body, true); case "create_passage": return createPassage(body); case "update_passage": return updatePassage(body); case "delete_passage": return deletePassage(body); case "import_questions": return importQuestions(body); case "import_explanations": return importExplanations(body); case "factory_start": return factoryStart(body); case "factory_confirm": return factoryConfirm(body);
    case "student_bootstrap": return studentBootstrap(session as ReadySession); case "student_passage": return studentPassage(body, session as ReadySession); case "word_lookup_meaning": return readerInlineGloss(body, session as ReadySession); case "save_reader_word": return saveReaderWord(body, session as ReadySession); case "remove_reader_word": return removeReaderWord(body, session as ReadySession); case "update_reader_word_meaning": return updateReaderWordMeaning(body, session as ReadySession); case "sentence_easy_translation": return sentenceEasyTranslation(body, session as ReadySession); case "sentence_structure": return sentenceStructure(body, session as ReadySession); case "student_questions": return studentQuestions(body, session as ReadySession); case "student_question_filters": return studentQuestionFilters(body, session as ReadySession); case "student_question_queue": return studentQuestionQueue(body, session as ReadySession); case "student_review_questions": return studentReviewQuestions(body, session as ReadySession); case "set_question_bookmark": return setQuestionBookmark(body, session as ReadySession); case "submit_attempt": return submitAttempt(body, session as ReadySession); case "student_workbook": return studentWorkbook(body, session as ReadySession); case "workbook_assistance": return workbookAssistance(body, session as ReadySession); case "set_workbook_bookmark": return setWorkbookBookmark(body, session as ReadySession); case "workbook_hint": return workbookHint(body, session as ReadySession); case "submit_workbook_attempt": return submitWorkbookAttempt(body, session as ReadySession);
    default: throw new ApiError(404, "알 수 없는 READY 작업입니다.");
  }
}
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS }); if (req.method !== "POST") return json({ error: "POST만 받습니다." }, 405);
  try { const body = await req.json(), op = clean(body?.op, 60); let session: ReadySession | null = null; if (adminOps.has(op)) session = await authenticate(req, "admin"); else if (studentOps.has(op)) session = await authenticate(req, "student"); else if (op === "logout") session = await authenticate(req); else if (!publicOps.has(op)) throw new ApiError(404, "알 수 없는 READY 작업입니다."); return json(await dispatch(op, body, session)); }
  catch (error) { console.error(error); return error instanceof ApiError ? json({ error: error.message, detail: error.detail }, error.status) : json({ error: "READY 서버에서 요청을 처리하지 못했습니다." }, 500); }
});
