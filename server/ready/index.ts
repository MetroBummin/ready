// READY — fixed Scope > Passage Reader
// Custom opaque sessions are validated here. Deploy this Edge Function with JWT verification disabled.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { bearerToken, randomSessionToken, secureEqual, sha256Hex, validPin } from "./auth-core.mjs";
import { lemma, tokenizeSentence } from "./lexical-core.mjs";
import { NE_MINBYEONGCHEON_L1_WORKBOOK } from "./workbook-ne-l1.mjs";
import { NE_MINBYEONGCHEON_L2_WORKBOOK } from "./workbook-ne-l2.mjs";
import { YBM_PARKJUNEON_L1_WORKBOOK } from "./workbook-ybm-l1.mjs";
import { YBM_PARKJUNEON_L2_WORKBOOK } from "./workbook-ybm-l2.mjs";
import { validateQuestionSpec } from "./question-spec.mjs";
import { deterministicGrade, publicInteractionContract } from "./interaction-contract.mjs";

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
const adminOps = new Set(["teacher_bootstrap", "delete_impact", "assign_scope_passages", "set_scope_passages", "create_passage", "update_passage", "delete_passage", "create_student", "set_student_pin", "delete_student", "import_questions", "import_explanations"]);
const studentOps = new Set(["student_bootstrap", "student_passage", "student_questions", "student_question_filters", "student_question_queue", "student_review_questions", "set_question_bookmark", "submit_attempt", "student_workbook", "set_workbook_bookmark", "submit_workbook_attempt"]);
const publicOps = new Set(["list_students", "student_login", "admin_login"]);
// Match Breeze's free Gemini dictionary defaults. The API key remains a
// Supabase Edge Function Secret and is never part of any public response.
const GEMINI_MODEL = "gemini-3.5-flash-lite";
const AI_DAILY_LIMIT = Math.max(1, Math.min(1_000, Number(Deno.env.get("AI_DAILY_LIMIT") ?? 100)));
const AI_GRADING_DAILY_LIMIT = Math.max(1, Math.min(1_000, Number(Deno.env.get("AI_GRADING_DAILY_LIMIT") ?? 100)));
const GEMINI_SYSTEM = "You are a precise bilingual dictionary for Korean learners reading English books. Reply with ONLY minified JSON. No markdown, no code fence, no commentary.";
const GEMINI_GRADING_SYSTEM = "You grade Korean secondary-school English answers against a publisher-verified semantic reference. Do not invent a new answer key. Accept faithful synonyms and paraphrases unless the supplied rubric explicitly requires exact words, forms, or word counts. Required grammar, conditions, slot boundaries, and required word counts remain strict. Reply with ONLY minified JSON.";

type ReadySession = { id: string; actor_type: "student" | "admin"; student_id: string | null; remembered: boolean; expires_at: string };
type Student = { id: string; name: string; school: string; grade: string };
class ApiError extends Error { constructor(public status: number, message: string, public detail?: unknown) { super(message); } }
function clean(value: unknown, max = 10_000) { return String(value ?? "").trim().slice(0, max); }
function required(value: unknown, name: string, max = 10_000) { const out = clean(value, max); if (!out) throw new ApiError(400, `${name} 값이 필요합니다.`); return out; }
function rows<T>(result: { data: T | null; error: { message: string } | null }): T { if (result.error) throw new ApiError(500, result.error.message); return result.data as T; }
function cleanList(value: unknown, count: number, max: number) { return (Array.isArray(value) ? value : []).map(item => clean(item, max)).filter(Boolean).slice(0, count); }
function parseJson(raw: string) { try { return JSON.parse(raw); } catch { /* Gemini occasionally adds a wrapper despite JSON mode. */ } const found = raw.match(/\{[\s\S]*\}/); if (!found) return null; try { return JSON.parse(found[0]); } catch { return null; } }

function geminiLookPrompt(word: string, clicked: string, sentence: string) {
  const form = clicked && clicked.toLowerCase() !== word.toLowerCase() ? `단어: ${word} (문장에서는 "${clicked}")` : `단어: ${word}`;
  return `${form}
문장: ${sentence || "(문장 없음 — 일반적인 뜻으로 답하세요)"}

이 문장에서 이 단어가 어떤 뜻으로 쓰였는지 판단하세요.

- lemma: 사전 표제어(원형). 고유명사나 약어면 그대로
- pos: 명사|동사|형용사|부사|전치사|기타 중 하나
- ko: 이 문장에서의 뜻. 한국어 8자 내외의 짧은 사전식 뜻
- note: 이 문장에서 어떻게 쓰였는지 한국어 한 문장으로 설명
- phrase: 클릭한 단어를 포함한 아주 확실한 고정 표현 하나만. 없으면 빈 문자열
- alts: 지금 문맥의 뜻과 겹치지 않는 흔한 다른 한국어 뜻을 최대 3개

{"lemma":"","pos":"","ko":"","note":"","phrase":"","alts":[""]}`;
}

async function callGeminiLook(word: string, clicked: string, sentence: string) {
  const provider = (Deno.env.get("AI_PROVIDER") ?? "").trim().toLowerCase();
  const key = Deno.env.get("GEMINI_API_KEY");
  if (provider !== "gemini" || !key) throw new ApiError(503, "Gemini 사전이 아직 연결되지 않았습니다.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  // Breeze intentionally requests JSON mode without responseSchema: Gemini's
  // OpenAPI-schema subset differs between models, while this prompt is stable.
  const base = { maxOutputTokens: 450, temperature: 0.2, responseMimeType: "application/json" };
  let lastError = "";
  // This is the same compatibility fallback Breeze uses for Gemini models
  // that do not yet accept thinkingConfig.
  for (const generationConfig of [{ ...base, thinkingConfig: { thinkingBudget: 0 } }, base]) {
    const response = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ system_instruction: { parts: [{ text: GEMINI_SYSTEM }] }, contents: [{ role: "user", parts: [{ text: geminiLookPrompt(word, clicked, sentence) }] }], generationConfig }),
    });
    if (response.ok) {
      const payload = await response.json();
      const text = (payload?.candidates?.[0]?.content?.parts || []).map((part: { text?: string }) => part?.text || "").join("").trim();
      const parsed = parseJson(text);
      if (parsed && clean(parsed.ko, 60)) return parsed;
      throw new ApiError(502, "Gemini가 단어 뜻을 읽지 못했습니다.");
    }
    lastError = (await response.text()).slice(0, 300);
    if (response.status !== 400) break;
  }
  console.error("READY Gemini lookup failed:", lastError);
  throw new ApiError(502, "Gemini 단어 사전을 잠시 사용할 수 없습니다.");
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

async function listStudents() { return { students: rows(await db.from("ready_students").select("id,name").eq("active", true).not("pin_hash", "is", null).order("school").order("grade").order("name")) }; }
async function studentLogin(body: any) {
  const studentId = required(body.studentId, "학생", 80), pin = clean(body.pin, 10);
  if (!validPin(pin)) throw new ApiError(400, "PIN은 숫자 4~6자리입니다.");
  const identifier = `student:${studentId}`; await assertLoginAllowed(identifier);
  const verified = await db.rpc("ready_verify_student_pin", { p_student_id: studentId, p_pin: pin });
  if (verified.error) throw new ApiError(500, verified.error.message);
  const ok = verified.data === true; await recordLogin(identifier, ok); if (!ok) throw new ApiError(401, "PIN이 맞지 않습니다.");
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
  const name = required(body.name, "학생 이름", 40), school = required(body.school, "학교", 80), grade = required(body.grade, "학년", 40), pin = clean(body.pin, 10);
  if (!validPin(pin)) throw new ApiError(400, "PIN은 숫자 4~6자리여야 합니다.");
  const result = await db.rpc("ready_create_student", { p_name: name, p_school: school, p_grade: grade, p_pin: pin, p_sort_order: 0 });
  return { student: rows<any[]>(result)[0] };
}
async function setStudentPin(body: any) { const studentId = required(body.studentId, "학생", 80), pin = clean(body.pin, 10); if (!validPin(pin)) throw new ApiError(400, "PIN은 숫자 4~6자리여야 합니다."); const result = await db.rpc("ready_set_student_pin", { p_student_id: studentId, p_pin: pin }); if (result.error) throw new ApiError(500, result.error.message); return { updated: studentId }; }
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
  const attempted = await attemptedQuestionIds(studentId, examId);
  const questionCounts = new Map<string, number>();
  const byId = new Map(sourcePassages.map(item => [item.id, item]));
  const passageText = new Map(linkedIds.map(id => [id, sentenceRows.filter(sentence => sentence.passage_id === id).map(sentence => sentence.text).join(" ")]));
  const normalizedQuestions = linkedIds.flatMap(passageId => normalizeMainTextQuestionRows(availableQuestions.filter(question => question.passage_id === passageId), byId.get(passageId), passageText.get(passageId) || ""));
  normalizedQuestions.forEach(question => {
    const passage = byId.get(question.passage_id);
    if (!attempted.has(question.id) && isReadyQuestion(question) && isMainTextQuestion(question, passage, passageText.get(question.passage_id) || "")) questionCounts.set(question.passage_id, (questionCounts.get(question.passage_id) || 0) + 1);
  });
  const passages = links.map(link => ({ ...byId.get(link.passage_id), position: link.position, question_count: questionCounts.get(link.passage_id) || 0 })).filter(item => item.id);
  return passages;
}
async function studentBootstrap(session: ReadySession) {
  const student = await studentForSession(session), scope = rows<any>(await db.from("ready_exams").select("id,school,grade").eq("school", student.school).eq("grade", student.grade).eq("is_current", true).maybeSingle());
  const passages = scope ? await scopePassages(scope.id, student.id) : [];
  const reviewCount = scope ? (await eligibleReviewQuestionIds(student.id, scope.id)).length + await workbookReviewCount(student.id, scope.id) : 0;
  return { student: { id: student.id, school: student.school, grade: student.grade }, scope, passages, reviewCount };
}
async function studentPassageAccess(examId: string, passageId: string, student: Student) { await studentExamAccess(examId, student); const linked = await db.from("ready_exam_passages").select("passage_id").eq("exam_id", examId).eq("passage_id", passageId).maybeSingle(); if (linked.error) throw new ApiError(500, linked.error.message); if (!linked.data) throw new ApiError(404, "현재 시험범위에 없는 지문입니다."); return rows<any>(await db.from("ready_passages").select("id,title,source_type,source_label,updated_at").eq("id", passageId).single()); }
async function studentPassage(body: any, session: ReadySession) {
  const student=await studentForSession(session),examId=required(body.examId,"Exam",80),passageId=required(body.passageId,"지문",80),passage=await studentPassageAccess(examId,passageId,student);
  const sentences=await db.from("ready_passage_sentences").select("id,sentence_index,text").eq("passage_id",passageId).order("sentence_index");
  return {passage,sentences:rows<any[]>(sentences)};
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
    id: row.id, type, family: clean(payload.family, 40) || (type === "written_response" ? "written" : "standard"), skill: publicSkill(renderSpec.taxonomy),
    taxonomy: renderSpec.taxonomy, renderer: renderSpec.renderer, renderSpec, importStatus: renderSpec.importStatus,
    prompt: clean(payload.prompt, 1_000), choices, choiceParts, multiSelect: interactionContract.selection === "multi", responseType: type === "written_response" ? "written" : "choice", responseSlots, writingGuide,
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
  return { items: selected.map(item => publicQuestion(item.row, item.passageText, { bookmarked: item.bookmarked })) };
}
async function studentQuestions(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80);
  const study = await studentPassage(body, session), passageId = study.passage.id;
  const questionRows = rows<any[]>(await db.from("ready_questions").select("id,type,payload,status,created_at").eq("passage_id", passageId).in("type", ["multiple_choice", "written_response"]).eq("status", "available").order("created_at"));
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
  return { items, workbookItems: await workbookReviewItems(student.id, examId) };
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

function workbookForPassage(passage: any) {
  const identity = [passage?.title, passage?.source_label].map(value => clean(value, 300)).join(" ");
  const lesson = /(?:Lesson|레슨|제)\s*2|2\s*과/i.test(identity) ? 2 : /(?:Lesson|레슨|제)\s*1|1\s*과/i.test(identity) ? 1 : 0;
  if(/(?:민병천|NE\s*능률|NE\s*\()/i.test(identity))return lesson===2?NE_MINBYEONGCHEON_L2_WORKBOOK:lesson===1?NE_MINBYEONGCHEON_L1_WORKBOOK:null;
  if(/(?:박준언|YBM)/i.test(identity))return lesson===2?YBM_PARKJUNEON_L2_WORKBOOK:lesson===1?YBM_PARKJUNEON_L1_WORKBOOK:null;
  return null;
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
  return bookmarks.flatMap(bookmark => {
    const passage = byPassage.get(bookmark.passage_id), catalog = workbookForPassage(passage), item = workbookItem(catalog, bookmark.item_key);
    if (!passage || !catalog || !item || catalog.workbookKey !== bookmark.workbook_key) return [];
    return [{ passageId: passage.id, passageTitle: passage.title, workbookKey: catalog.workbookKey, workbookTitle: catalog.title, itemKey: item.key, stage: item.stage, number: item.number, kind: item.kind, title: catalog.stages.find((stage: any) => stage.stage === item.stage)?.title || `${item.stage}단계`, bookmarked: true, bookmarkSource: bookmark.source, lastResult: latest.get(`${passage.id}:${item.key}`) ?? null }];
  });
}
function normalizeWorkbookAnswer(value: unknown) {
  return clean(value, 1_000).normalize("NFKC").toLowerCase()
    .replace(/[“”‘’'".,!?;:()[\]{}]/g, "")
    .replace(/\s+/g, " ").trim();
}
async function studentWorkbook(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), passageId = required(body.passageId, "지문", 80);
  const passage = await studentPassageAccess(examId, passageId, student), catalog = workbookForPassage(passage);
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
      completed: latest.get(item.key) === true, lastResult: latest.get(item.key) ?? null, bookmarked: bookmarks.has(item.key),
    })),
  }));
  return { workbookKey: catalog.workbookKey, title: catalog.title, passage: { id: passage.id, title: passage.title }, stages };
}
async function setWorkbookBookmark(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), passageId = required(body.passageId, "지문", 80), itemKey = required(body.itemKey, "워크북 문제", 120), bookmarked = body.bookmarked === true;
  const passage = await studentPassageAccess(examId, passageId, student), catalog = workbookForPassage(passage), item = workbookItem(catalog, itemKey);
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
  const passage = await studentPassageAccess(examId, passageId, student), catalog = workbookForPassage(passage), item = workbookItem(catalog, itemKey);
  if (!catalog || !item) throw new ApiError(404, "현재 풀 수 없는 워크북 문제입니다.");
  const responses = cleanList(body.responses, 80, 1_000);
  if (responses.length !== item.answers.length) throw new ApiError(400, "모든 빈칸을 입력해 주세요.");
  let slotResults = responses.map((response, index) => normalizeWorkbookAnswer(response) === normalizeWorkbookAnswer(item.answers[index])), correct = slotResults.every(Boolean), aiFeedback = "", aiRequestId: string | null = null;
  if(item.kind==="translation_ai"&&!correct){
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const used = await db.from("ready_workbook_ai_grading_requests").select("id", { count: "exact", head: true }).eq("student_id", student.id).gte("created_at", today.toISOString());
    if (used.error) throw new ApiError(500, used.error.message);
    if ((used.count || 0) >= AI_GRADING_DAILY_LIMIT) throw new ApiError(429, `오늘 AI 채점 ${AI_GRADING_DAILY_LIMIT}회를 모두 사용했습니다.`);
    const pseudoQuestion={payload:{accepted_answers:[[item.answers[0]]]}};
    const pseudoSpec={prompt:"다음 영문을 우리말로 해석하시오.",writingGuide:{taskText:item.source,conditions:[],wordBank:[]},responseSlots:[{label:"해석",wordCount:null}]};
    const pending = rows<any>(await db.from("ready_workbook_ai_grading_requests").insert({ student_id: student.id, exam_id: examId, passage_id: passageId, workbook_key: catalog.workbookKey, item_key: item.key, response: { responses }, rubric_snapshot: { source: item.source, referenceAnswer: item.answers[0] }, status: "pending" }).select("id").single());
    aiRequestId = pending.id;
    try {
      const grade=await callGeminiGrade(pseudoQuestion,pseudoSpec,responses);correct=grade.correct;slotResults=[grade.correct];aiFeedback=grade.shortFeedback;
      const completed = await db.from("ready_workbook_ai_grading_requests").update({ status: "completed", result: { correct: grade.correct, score: grade.score, short_feedback: grade.shortFeedback, error_tags: grade.errorTags }, completed_at: new Date().toISOString() }).eq("id", aiRequestId).eq("status", "pending");
      if (completed.error) throw new ApiError(500, completed.error.message);
    } catch (error) {
      await db.from("ready_workbook_ai_grading_requests").update({ status: "failed", error_code: error instanceof ApiError ? `http_${error.status}` : "unknown", completed_at: new Date().toISOString() }).eq("id", aiRequestId).eq("status", "pending");
      throw error;
    }
  }
  const inserted = rows<any>(await db.from("ready_workbook_attempts").insert({
    student_id: student.id, exam_id: examId, passage_id: passageId, workbook_key: catalog.workbookKey,
    item_key: item.key, stage: item.stage, response: { responses }, correct,
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
  return { attempt: inserted, correct, answers: correct ? [] : item.answers, slotResults, aiFeedback, aiRequestId, bookmarked: !!bookmark.data, reviewCount: (await eligibleReviewQuestionIds(student.id, examId)).length + await workbookReviewCount(student.id, examId) };
}
function normalizedWord(value: unknown) { return clean(value, 100).toLowerCase().replace(/[^a-z']/g, "").replace(/^'+|'+$/g, ""); }
async function studyContext(body: any, session: ReadySession, sentenceRequired = false) { const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), passageId = required(body.passageId, "지문", 80), passage = await studentPassageAccess(examId, passageId, student), sentenceId = clean(body.sentenceId, 80); let sentence:any = null; if (sentenceRequired || sentenceId) { sentence = rows<any>(await db.from("ready_passage_sentences").select("id,text,translation").eq("id", required(sentenceId, "문장", 80)).eq("passage_id", passage.id).single()); } return { student, examId, passage, sentence }; }
async function wordLookup(body: any, session: ReadySession) {
  const context = await studyContext(body, session), surfaceWord = required(body.word, "단어", 100), normalized = normalizedWord(surfaceWord), root = lemma(normalized);
  if (!normalized) throw new ApiError(400, "영어 단어만 조회할 수 있습니다.");
  const [knownState, savedSenses] = await Promise.all([
    db.from("ready_word_states").select("known").eq("student_id", context.student.id).eq("passage_id", context.passage.id).eq("normalized_word", root).maybeSingle(),
    db.from("ready_saved_words").select("meaning_snapshot").eq("student_id", context.student.id).eq("passage_id", context.passage.id).eq("normalized_word", root).order("created_at"),
  ]);
  if (knownState.error) throw new ApiError(500, knownState.error.message);
  if (savedSenses.error) throw new ApiError(500, savedSenses.error.message);
  const known = knownState.data?.known === true;
  const existingMeanings = rows<any[]>(savedSenses).map(item => clean(item.meaning_snapshot, 500)).filter(Boolean);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const used = await db.from("ready_word_lookup_events").select("id", { count: "exact", head: true }).eq("student_id", context.student.id).gte("created_at", today.toISOString());
  if (used.error) throw new ApiError(500, used.error.message);
  if ((used.count || 0) >= AI_DAILY_LIMIT) throw new ApiError(429, `오늘 Gemini 단어 사전 ${AI_DAILY_LIMIT}회를 모두 사용했습니다.`);
  const event = await db.from("ready_word_lookup_events").insert({ student_id: context.student.id, exam_id: context.examId, passage_id: context.passage.id, sentence_id: context.sentence?.id || null, surface_word: surfaceWord, normalized_word: root });
  if (event.error) throw new ApiError(500, event.error.message);
  // Do not use the legacy lemma-only cache here: the same lemma can mean
  // different things in two sentences. Breeze caches by lemma + context.
  const result = await callGeminiLook(root, surfaceWord, context.sentence?.text || "");
  const meaning = clean(result.ko, 60), alts = cleanList(result.alts, 3, 40).filter(item => item !== meaning);
  if (!known && meaning) {
    const automaticSave = await db.from("ready_saved_words").upsert({
      student_id: context.student.id, passage_id: context.passage.id, sentence_id: context.sentence?.id || null,
      word: surfaceWord, normalized_word: root, meaning_snapshot: meaning, meaning_key: meaningKey(meaning),
    }, { onConflict: "student_id,passage_id,normalized_word,meaning_key", ignoreDuplicates: true });
    if (automaticSave.error) throw new ApiError(500, automaticSave.error.message);
  }
  return {
    word: surfaceWord, normalizedWord: root, meaning, meanings: [meaning, ...alts],
    pos: clean(result.pos, 12), note: clean(result.note, 300), phrase: clean(result.phrase, 80),
    provider: "gemini", cached: false, known, savedMeanings: known ? existingMeanings : [...new Set([...existingMeanings, meaning])].filter(Boolean),
    remaining: Math.max(0, AI_DAILY_LIMIT - (used.count || 0) - 1),
  };
}
function meaningKey(value: string) { return clean(value, 500).toLowerCase().replace(/\s+/g, " "); }
async function saveWord(body:any,session:ReadySession){const context=await studyContext(body,session),word=required(body.word,"단어",100),normalized=normalizedWord(body.normalizedWord||word),root=lemma(normalized),meaning=required(body.meaning,"선택한 뜻",500);if(!root)throw new ApiError(400,"영어 단어만 저장할 수 있습니다.");const known=await db.from("ready_word_states").select("known").eq("student_id",context.student.id).eq("passage_id",context.passage.id).eq("normalized_word",root).maybeSingle();if(known.error)throw new ApiError(500,known.error.message);if(known.data?.known)throw new ApiError(409,"아는 단어로 표시했습니다. 다시 학습하기를 누른 뒤 저장할 수 있습니다.");const saved=await db.from("ready_saved_words").upsert({student_id:context.student.id,passage_id:context.passage.id,sentence_id:context.sentence?.id||null,word,normalized_word:root,meaning_snapshot:meaning,meaning_key:meaningKey(meaning)},{onConflict:"student_id,passage_id,normalized_word,meaning_key",ignoreDuplicates:true}).select("id,meaning_snapshot").maybeSingle();if(saved.error)throw new ApiError(500,saved.error.message);return {saved:true,normalizedWord:root,meaning};}
async function setWordKnown(body:any,session:ReadySession,known:boolean){const context=await studyContext(body,session),root=lemma(normalizedWord(required(body.normalizedWord||body.word,"단어",100)));if(!root)throw new ApiError(400,"영어 단어만 처리할 수 있습니다.");const result=await db.rpc("ready_set_word_known",{p_student_id:context.student.id,p_passage_id:context.passage.id,p_normalized_word:root,p_known:known});if(result.error)throw new ApiError(500,result.error.message);return {known,normalizedWord:root};}
async function deleteSavedWord(body:any,session:ReadySession){const student=await studentForSession(session),savedWordId=required(body.savedWordId,"저장 단어",80),result=await db.from("ready_saved_words").delete().eq("id",savedWordId).eq("student_id",student.id).select("id,normalized_word").maybeSingle();if(result.error)throw new ApiError(500,result.error.message);if(!result.data)throw new ApiError(404,"저장 단어를 찾지 못했습니다.");return {deleted:result.data.id,normalizedWord:result.data.normalized_word};}
async function translationView(body: any, session: ReadySession) { const context = await studyContext(body, session, true); const event = await db.from("ready_sentence_translation_view_events").insert({ student_id: context.student.id, exam_id: context.examId, passage_id: context.passage.id, sentence_id: context.sentence.id }); if (event.error) throw new ApiError(500, event.error.message); return { recorded:true }; }
async function saveSentence(body: any, session: ReadySession) { const context = await studyContext(body, session, true); const saved = await db.from("ready_saved_sentences").upsert({ student_id: context.student.id, exam_id: context.examId, passage_id: context.passage.id, sentence_id: context.sentence.id, source_text_snapshot: context.sentence.text, translation_snapshot: context.sentence.translation }, { onConflict: "student_id,sentence_id", ignoreDuplicates: true }).select().maybeSingle(); if (saved.error) throw new ApiError(500, saved.error.message); return { saved: true }; }
async function deleteSavedSentence(body:any,session:ReadySession){const student=await studentForSession(session),savedSentenceId=required(body.savedSentenceId,"저장 문장",80),result=await db.from("ready_saved_sentences").delete().eq("id",savedSentenceId).eq("student_id",student.id).select("id,sentence_id").maybeSingle();if(result.error)throw new ApiError(500,result.error.message);if(!result.data)throw new ApiError(404,"저장 문장을 찾지 못했습니다.");return {deleted:result.data.id,sentenceId:result.data.sentence_id};}
async function personalLibrary(_body:any,session:ReadySession){const student=await studentForSession(session),[words,sentences]=await Promise.all([
  db.from("ready_saved_words").select("id,word,normalized_word,meaning_snapshot,created_at,passage:ready_passages(title)").eq("student_id",student.id).order("created_at",{ascending:false}),
  db.from("ready_saved_sentences").select("id,sentence_id,source_text_snapshot,translation_snapshot,created_at,passage:ready_passages(title)").eq("student_id",student.id).order("created_at",{ascending:false})]);return {words:rows(words),sentences:rows(sentences)};}
async function dispatch(op: string, body: any, session: ReadySession | null) {
  switch (op) {
    case "list_students": return listStudents(); case "student_login": return studentLogin(body); case "admin_login": return adminLogin(body); case "logout": return revokeSession(session as ReadySession);
    case "teacher_bootstrap": return teacherBootstrap(); case "delete_impact": return deleteImpact(body); case "create_student": return createStudent(body); case "set_student_pin": return setStudentPin(body); case "delete_student": return deleteStudent(body);
    case "assign_scope_passages": return setScopePassages(body, false); case "set_scope_passages": return setScopePassages(body, true); case "create_passage": return createPassage(body); case "update_passage": return updatePassage(body); case "delete_passage": return deletePassage(body); case "import_questions": return importQuestions(body); case "import_explanations": return importExplanations(body);
    case "student_bootstrap": return studentBootstrap(session as ReadySession); case "student_passage": return studentPassage(body, session as ReadySession); case "student_questions": return studentQuestions(body, session as ReadySession); case "student_question_filters": return studentQuestionFilters(body, session as ReadySession); case "student_question_queue": return studentQuestionQueue(body, session as ReadySession); case "student_review_questions": return studentReviewQuestions(body, session as ReadySession); case "set_question_bookmark": return setQuestionBookmark(body, session as ReadySession); case "submit_attempt": return submitAttempt(body, session as ReadySession); case "student_workbook": return studentWorkbook(body, session as ReadySession); case "set_workbook_bookmark": return setWorkbookBookmark(body, session as ReadySession); case "submit_workbook_attempt": return submitWorkbookAttempt(body, session as ReadySession);
    default: throw new ApiError(404, "알 수 없는 READY 작업입니다.");
  }
}
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS }); if (req.method !== "POST") return json({ error: "POST만 받습니다." }, 405);
  try { const body = await req.json(), op = clean(body?.op, 60); let session: ReadySession | null = null; if (adminOps.has(op)) session = await authenticate(req, "admin"); else if (studentOps.has(op)) session = await authenticate(req, "student"); else if (op === "logout") session = await authenticate(req); else if (!publicOps.has(op)) throw new ApiError(404, "알 수 없는 READY 작업입니다."); return json(await dispatch(op, body, session)); }
  catch (error) { console.error(error); return error instanceof ApiError ? json({ error: error.message, detail: error.detail }, error.status) : json({ error: "READY 서버에서 요청을 처리하지 못했습니다." }, 500); }
});
