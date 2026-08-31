// READY — fixed Scope > Passage Reader
// Custom opaque sessions are validated here. Deploy this Edge Function with JWT verification disabled.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { bearerToken, randomSessionToken, secureEqual, sha256Hex, validPin } from "./auth-core.mjs";
import { lemma, tokenizeSentence } from "./lexical-core.mjs";
import { NE_MINBYEONGCHEON_L1_WORKBOOK } from "./workbook-ne-l1.mjs";
import { validateQuestionSpec } from "./question-spec.mjs";

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
const studentOps = new Set(["student_bootstrap", "student_passage", "student_questions", "student_review_questions", "set_question_bookmark", "submit_attempt", "student_workbook", "submit_workbook_attempt"]);
const publicOps = new Set(["list_students", "student_login", "admin_login"]);
// Match Breeze's free Gemini dictionary defaults. The API key remains a
// Supabase Edge Function Secret and is never part of any public response.
const GEMINI_MODEL = "gemini-3.5-flash-lite";
const AI_DAILY_LIMIT = Math.max(1, Math.min(1_000, Number(Deno.env.get("AI_DAILY_LIMIT") ?? 100)));
const AI_GRADING_DAILY_LIMIT = Math.max(1, Math.min(1_000, Number(Deno.env.get("AI_GRADING_DAILY_LIMIT") ?? 100)));
const GEMINI_SYSTEM = "You are a precise bilingual dictionary for Korean learners reading English books. Reply with ONLY minified JSON. No markdown, no code fence, no commentary.";
const GEMINI_GRADING_SYSTEM = "You grade Korean secondary-school English answers against a publisher-verified reference. Do not invent a new answer key. Accept a response only when its meaning, required grammar, conditions, slot boundaries, and required word counts satisfy the supplied rubric. Reply with ONLY minified JSON.";

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
  const generationConfig = { maxOutputTokens: 500, temperature: 0, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } };
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system_instruction: { parts: [{ text: GEMINI_GRADING_SYSTEM }] }, contents: [{ role: "user", parts: [{ text: aiGradingPrompt(question, spec, responses) }] }], generationConfig }) });
  if (!response.ok) { console.error("READY AI grading failed:", (await response.text()).slice(0, 300)); throw new ApiError(502, "AI 채점을 잠시 사용할 수 없습니다. 답안은 저장되었습니다."); }
  const payload = await response.json(), text = (payload?.candidates?.[0]?.content?.parts || []).map((part: { text?: string }) => part?.text || "").join("").trim(), parsed = parseJson(text);
  if (!parsed || typeof parsed.correct !== "boolean" || !Number.isFinite(Number(parsed.score))) throw new ApiError(502, "AI 채점 결과를 확인하지 못했습니다. 답안은 저장되었습니다.");
  return { correct: parsed.correct === true, score: Math.max(0, Math.min(100, Math.round(Number(parsed.score)))), shortFeedback: clean(parsed.short_feedback, 160), errorTags: cleanList(parsed.error_tags, 8, 40) };
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
      if (/NE능률\(민병천\)/.test(clean(source.exam, 180)) && source.passage_no) {
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
  const reviewCount = scope ? (await eligibleReviewQuestionIds(student.id, scope.id)).length : 0;
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
function publicSegments(value: unknown) {
  return (Array.isArray(value) ? value : []).slice(0, 500).map((segment: any) => ({ text: clean(segment?.text, 5_000), kind: clean(segment?.kind, 20), label: clean(segment?.label, 20) }));
}
function publicBlocks(value: unknown) {
  return (Array.isArray(value) ? value : []).slice(0, 80).map((block: any) => ({ kind: clean(block?.kind, 20), label: clean(block?.label, 80), text: clean(block?.text, 10_000), url: clean(block?.url, 2_000), alt: clean(block?.alt, 200), caption: clean(block?.caption, 500), segments: publicSegments(block?.segments) }));
}
function inlineOptionGroups(value: unknown) {
  const text = clean(value, 30_000), groups: Array<{label:string,options:string[]}> = [];
  for (const match of text.matchAll(/([ⓐ-ⓩ]|\([A-H]\))\s*\[([^\]]+)\]/g)) {
    const options = match[2].split("/").map(option => clean(option, 100)).filter(Boolean);
    if (options.length >= 2 && options.length <= 4) groups.push({ label: match[1], options });
  }
  return groups.length && groups.length <= 8 ? groups : [];
}
function publicTargetRanges(value: unknown) {
  return (Array.isArray(value) ? value : []).slice(0, 8).map((target: any) => ({ label: clean(target?.label, 20), text: clean(target?.text, 200), canonicalText: clean(target?.canonical_text ?? target?.canonicalText, 200) || clean(target?.text, 200) })).filter(target => target.label && target.text);
}
function expandedTargetRanges(targets: Array<{label:string,text:string,canonicalText:string}>, canonical: string) {
  const particles = "off|on|up|out|in|away|back|over|down|through|around|along";
  return targets.map(target => {
    const escaped = target.canonicalText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const match = new RegExp(`\\b(${escaped})\\s+(${particles})\\b`, "i").exec(canonical);
    if (!match || /\s/.test(target.text)) return target;
    return { ...target, text: `${target.text} ${match[2]}`, canonicalText: `${match[1]} ${match[2]}` };
  });
}
function answerWordCount(slot: unknown) {
  const variants = (Array.isArray(slot) ? slot : [slot]).map(value => clean(value, 2_000)).filter(Boolean);
  const counts = [...new Set(variants.map(value => (value.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g) || []).length))];
  return counts.length === 1 && counts[0] > 0 ? counts[0] : null;
}
function koreanTaskText(value: unknown) {
  const text = clean(value, 30_000), matches = text.match(/[가-힣][가-힣A-Za-z0-9\s,.'’“”()·-]{8,}?(?:다|요)\./g) || [];
  return matches.sort((a, b) => b.length - a.length)[0]?.trim() || "";
}
const SUMMARY_REPAIRS: Record<number, string> = {
  101: "Since student (1)__________ in the Riverdale Science Fair is still not enough, the science teacher encourages students to (2)__________ work related to a sustainable future. (1) (2)",
  106: "Luna's initial (1)___________ upon receiving the wrong birthday cake quickly turned into a(n) (2)___________ once the bakery's mistake was corrected. (1) (2)",
  111: "The belief that a group of (1)______________ members will automatically succeed is a misconception because it (2)______________ how those members can function as a whole. (1) (2)",
  117: "The human brain evolved the ability to form mental images of the world to (1)__________ actions in advance, but evolution ensured these images remain (2)__________ to prevent us from confusing them with reality. (1) (2)",
  122: "When making decisions, people tend to give low-probability events (1)______________ than their objective chances deserve, making them seem (2)______________ than they really are. (1) (2)",
  127: "The real barriers to trade lie in transaction costs, but a common currency can help to ㉠_____________ them, which in turn leads to a(n) ㉡_____________ in the overall economy.㉠ ㉡",
  132: "Since starlight travels a great distance before reaching us, observing the stars gives us a(n) (1)_____________ to explore the (2)_____________ of the universe. (1) (2)",
  137: "Jacob Lawrence was an American painter who gained national (1)______________ by (2)______________ the lives of African-Americans in his paintings. (1) (2)",
  343: "Because ____________ for the Riverdale Science Fair is lower than expected, Mr. Howard wants to ____________ students to participate by submitting a simple ____________ of their work on environmental conservation or renewable energy by June 25.",
  344: "When Luna realized that the message and flavor of the cake were ____________, she wondered whether she ____________ ____________ ____________, but the baker returned with the correct cake and explained that they had taken ____________ ____________ ____________, leaving her completely satisfied.",
  345: "It seems logical to assume the whole will be as _____________ and _____________ as its individual parts, but the fallacy of composition overlooks how the individuals _____________ _____________ each other, so it’s always necessary to check not only the individuals but also the _____________ _____________ when assembling a team.",
  346: "Although humans have the ability to create mental images and ___________ future actions, ___________ has prevented these images from fully substituting ___________ experiences so that we would not ___________ ___________ ___________.",
  347: "People tend to ____________ the likelihood of ____________ events, causing them to influence ____________ more than they should.",
  348: "By removing various transaction costs that act as barriers to trade, a(n) ____________ ____________ allows companies to turn ____________ costs into ____________ ones, helping whole economies ____________ and ____________.",
  349: "Since light from distant stars takes a long time to _____________ to Earth, observing them allows us to see the _____________ as it existed in the _____________.",
  350: "Jacob Lawrence: A _____________ of _____________ History and Life",
};
const TARGET_RANGE_REPAIRS: Record<number, Array<{label:string,text:string,canonicalText?:string}>> = {
  6: [{label:"ⓐ",text:"what"},{label:"ⓑ",text:"They"},{label:"ⓒ",text:"ordering"},{label:"ⓓ",text:"have received"},{label:"ⓔ",text:"Knowing"}],
  11: [{label:"ⓐ",text:"that"},{label:"ⓑ",text:"is"},{label:"ⓒ",text:"That"},{label:"ⓓ",text:"the different “parts” interact with each other"},{label:"ⓔ",text:"assembling"}],
  15: [{label:"ⓐ",text:"which"},{label:"ⓑ",text:"them"},{label:"ⓒ",text:"shows"},{label:"ⓓ",text:"were"},{label:"ⓔ",text:"consuming"}],
  97: [{label:"ⓐ",text:"Although"},{label:"ⓑ",text:"to take part"},{label:"ⓒ",text:"is related",canonicalText:"related"},{label:"ⓓ",text:"interesting",canonicalText:"interested"},{label:"ⓔ",text:"submit"}],
  102: [{label:"ⓐ",text:"to pick up"},{label:"ⓑ",text:"that"},{label:"ⓒ",text:"waited"},{label:"ⓓ",text:"explained"},{label:"ⓔ",text:"had chosen"},{label:"ⓕ",text:"even better than I imagined"}],
  103: [{label:"(A)",text:"understand"},{label:"(B)",text:"wrong"},{label:"(C)",text:"unrelated"},{label:"(D)",text:"poor-quality"},{label:"(E)",text:"better"}],
  107: [{label:"(A)",text:"assume"},{label:"(B)",text:"reasonable"},{label:"(C)",text:"fails to allow for"},{label:"(D)",text:"solution"},{label:"(E)",text:"possess a stable center"}],
  109: [{label:"ⓐ",text:"that"},{label:"ⓑ",text:"what"},{label:"ⓒ",text:"how"},{label:"ⓓ",text:"the other"},{label:"ⓔ",text:"composing"},{label:"ⓕ",text:"assembled"},{label:"ⓖ",text:"involved"}],
  112: [{label:"(A)",text:"excel at visual imagery"},{label:"(B)",text:"overlook forthcoming actions"},{label:"(C)",text:"the same regions"},{label:"(D)",text:"real thing"},{label:"(E)",text:"reflection"},{label:"(F)",text:"consumption of a feast"}],
  113: [{label:"ⓐ",text:"where"},{label:"ⓑ",text:"are"},{label:"ⓒ",text:"what"},{label:"ⓓ",text:"internal generated"},{label:"ⓔ",text:"authentically"},{label:"ⓕ",text:"yourself"}],
  114: [{label:"㉠",text:"a wise bit of self-restraint on your genes’ part"}],
  118: [{label:"ⓐ",text:"that"},{label:"ⓑ",text:"can define",canonicalText:"can be defined"},{label:"ⓒ",text:"the most",canonicalText:"the more"},{label:"ⓓ",text:"playing",canonicalText:"play"},{label:"ⓔ",text:"is",canonicalText:"are"}],
  123: [{label:"ⓐ",text:"exists"},{label:"ⓑ",text:"to hedge"},{label:"ⓒ",text:"what"},{label:"ⓓ",text:"reinvesting"},{label:"ⓔ",text:"from which"}],
  128: [{label:"ⓐ",text:"to reach"},{label:"ⓑ",text:"it"},{label:"ⓒ",text:"is"},{label:"ⓓ",text:"familiar"},{label:"ⓔ",text:"were"}],
  133: [{label:"ⓐ",text:"was known"},{label:"ⓑ",text:"simplified"},{label:"ⓒ",text:"bring"},{label:"ⓓ",text:"produced"},{label:"ⓔ",text:"including"}],
  233: [{label:"(A)",text:"encourage more of you to take part"}], 234: [{label:"(A)",text:"this looks perfect, even better than I imagined"}],
  235: [{label:"(A)",text:"lack a stable center"}], 236: [{label:"(A)",text:"You cannot cloy the hungry edge of appetite by bare imagination of a feast"}],
  237: [{label:"(A)",text:"factor more into decisions than they should"}], 238: [{label:"(A)",text:"useless costs turn into productive costs"}],
  239: [{label:"(A)",text:"we are looking back in time"}], 240: [{label:"(A)",text:"continued to explore the lives of African-Americans through his painting"}],
  277: [{label:"ⓐ",text:"The annual Riverdale Science Fair will hold on July 18"},{label:"ⓑ",text:"submitting"}],
  278: [{label:"(A)",text:"우리는 더 많은 여러분들이 참가하기를 독려하고 싶습니다."}], 279: [{label:"(B)",text:"여러분은 환경 보전 또는 재생 가능 에너지와 관련된 프로젝트, 실험, 또는 모델을 선보이도록 요청받습니다."}],
  280: [{label:"ⓐ",text:"she couldn’t understand that she saw"},{label:"ⓑ",text:"Known she had chosen a quality bakery"}],
  281: [{label:"(A)",text:"그녀는 주문했을 때 자신이 실수를 한 건지 궁금했다."}], 282: [{label:"(B)",text:"그는 그녀의 케이크와 함께 돌아왔고, 그들은 두 개의 비슷한 주문을 받았다고 설명했다."}],
  283: [{label:"ⓐ",text:"that"},{label:"ⓑ",text:"assuming"},{label:"ⓒ",text:"how"},{label:"ⓓ",text:"collating"},{label:"ⓔ",text:"is composed"}],
  284: [{label:"(A)",text:"당신은 당신이 합류시킨 모든 사람이 생산적이고 효율적이라는 것을 안다."}], 285: [{label:"(B)",text:"공동의 목표를 가진 팀을 구성할 때, 관련된 개개인뿐만 아니라 전체적인 관점도 항상 확인하라."}],
  286: [{label:"ⓐ",text:"which"},{label:"ⓑ",text:"such internally generating representations"}],
  287: [{label:"(A)",text:"심지어 당신의 뇌가 장면을 상상하기 위해 당신이 실제로 장면을 볼 때와 같은 영역을 사용하는 것을 보여주는 Harvard 대학교 심리학자 Steve Kosslyn에 의한 뇌 영상 연구들로부터 나온 단서들도 있다."}],
  288: [{label:"(B)",text:"만약 세계에 대한 당신의 내적 모델이 완벽한 대체물이라면, 당신이 언제든 배고픔을 느낄 때 연회에서 당신 자신이 진수성찬을 먹는 것을 단순히 상상할 것이다."}],
  289: [{label:"ⓐ",text:"Events what could happen but aren’t likely"},{label:"ⓑ",text:"people who play the lottery is often optimistic about winning"},{label:"ⓒ",text:"the odds of a single ticket wins the largest, most popular U.S. lotteries"}],
  290: [{label:"(A)",text:"객관적인 1퍼센트의 발생 가능성을 가진 사건이 주관적으로는 5퍼센트의 발생 가능성을 가진 것처럼 보일 수 있다."}], 291: [{label:"(B)",text:"확률이 더 작을수록, 우리는 그것의 가능성을 더 과대평가한다."}],
  292: [{label:"ⓐ",text:"exists"},{label:"ⓑ",text:"getting products to market at competitive prices"},{label:"ⓒ",text:"hedging funds"},{label:"ⓓ",text:"unifying some of the currencies"},{label:"ⓔ",text:"growing"}],
  293: [{label:"(A)",text:"공동 통화를 갖는다는 것은 그러한 많은 거래 비용들이 사라지고 그 절감분이 기업들의 생산성과 혁신으로 재투자될 수 있음을 의미한다."}],
  295: [{label:"ⓐ",text:"that glows in the Orion constellation"},{label:"ⓑ",text:"is even further away"},{label:"ⓒ",text:"what we have a chance of understanding the history of the universe"}],
  296: [{label:"(A)",text:"우리가 더 먼 곳으로부터 온 빛을 모을 수 있을수록, 우리는 시간상으로 더 먼 과거를 볼 수 있다."}], 297: [{label:"(B)",text:"여러 세대의 인간에게 익숙한, 그것들의 빛은 최소 1,000년을 이동하여 우리에게 도달했다."}],
  298: [{label:"ⓐ",text:"is known for vivid scenes of African-American history and daily life"},{label:"ⓑ",text:"most of them lost"}],
  299: [{label:"(A)",text:"1917년 Atlantic City에서 태어나서, 그는 13세에 Harlem으로 이주해 Utopia Children’s Center에서 미술을 공부했다."}], 300: [{label:"(B)",text:"Jacob Lawrence의 걸작으로 널리 여겨지는 The Migration Series는 그에게 전국적인 인정을 가져다주었다."}],
};
const CHOICE_PART_REPAIRS: Record<number, string[][]> = {
  1: [["be held", "invited", "to showcase"], ["hold", "inviting", "showcase"], ["be held", "invited", "showcase"], ["hold", "invited", "to showcase"], ["be held", "inviting", "to showcase"]],
  19: [["aren’t", "are", "wins"], ["isn’t", "are", "winning"], ["aren’t", "are", "winning"], ["aren’t", "is", "winning"], ["isn’t", "is", "wins"]],
  23: [["because", "Having", "grow"], ["because of", "Having", "grow"], ["because", "Have", "growing"], ["because of", "Having", "growing"], ["because of", "Have", "grow"]],
  28: [["further", "which", "have"], ["further", "that", "has"], ["far", "which", "has"], ["further", "which", "has"], ["far", "that", "have"]],
  31: [["where", "that", "was"], ["which", "that", "was"], ["where", "those", "was"], ["which", "those", "were"], ["where", "that", "were"]],
  35: [["studied", "regarded", "lost"], ["studies", "regarding", "lost"], ["studied", "regarding", "were lost"], ["studies", "regarded", "were lost"], ["studied", "regarded", "were lost"]],
  39: [["melt", "learn", "bowls"], ["melting", "learn", "bowl"], ["melt", "to learn", "bowl"], ["melt", "learn", "bowl"], ["melting", "to learn", "bowls"]],
  99: [["evaluate", "conservation", "showcase"], ["present", "destruction", "showcase"], ["present", "conservation", "showcase"], ["evaluate", "destruction", "review"], ["present", "conservation", "review"]],
  101: [["absence", "exhibit"], ["enrollment", "appreciate"], ["participation", "display"], ["criticism", "revise"], ["competition", "submit"]],
  106: [["frustration", "regret"], ["excitement", "relief"], ["confusion", "satisfaction"], ["relief", "delight"], ["embarrassment", "anger"]],
  111: [["incompetent", "neglects"], ["skilled", "prioritizes"], ["competent", "overlooks"], ["unqualified", "considers"], ["capable", "highlights"]],
  117: [["rehearse", "perfect"], ["avoid", "incomplete"], ["simulate", "imperfect"], ["predict", "limited"], ["practice", "authentic"]],
  119: [["subjective", "smaller", "pessimistic"], ["subjective", "smaller", "optimistic"], ["objective", "larger", "optimistic"], ["subjective", "larger", "pessimistic"], ["objective", "smaller", "pessimistic"]],
  122: [["more consideration", "less likely"], ["little thought", "more significant"], ["low priority", "more certain"], ["more value", "less important"], ["more weight", "more likely"]],
  125: [["substantial", "disappear", "productive"], ["negligible", "remain", "wasteful"], ["substantial", "disappear", "wasteful"], ["negligible", "remain", "productive"], ["substantial", "remain", "productive"]],
  127: [["remove", "decline"], ["preserve", "benefit"], ["eliminate", "improvement"], ["multiply", "edge"], ["erase", "setback"]],
  129: [["back", "further", "distant"], ["back", "further", "nearby"], ["back", "nearer", "distant"], ["forward", "further", "nearby"], ["forward", "nearer", "distant"]],
  132: [["obstacle", "past"], ["illusion", "composition"], ["opportunity", "history"], ["challenge", "evolution"], ["chance", "future"]],
  134: [["vague", "criticism", "preserved"], ["vague", "recognition", "lost"], ["vivid", "criticism", "preserved"], ["vivid", "recognition", "preserved"], ["vivid", "recognition", "lost"]],
  137: [["disregard", "ignoring"], ["fame", "distorting"], ["criticism", "depicting"], ["wealth", "financing"], ["recognition", "portraying"]],
};
function publicChoiceParts(value: unknown) {
  return (Array.isArray(value) ? value : []).slice(0, 8).map(row => cleanList(row, 4, 200)).filter(row => row.length > 1);
}
const WRITING_GUIDE_REPAIRS: Record<number, any> = {
  277: { kind:"correction", title:"밑줄 친 ⓐ, ⓑ의 어색한 부분을 각각 알맞게 고쳐 쓰세요.", slotLabels:["ⓐ 고친 말","ⓑ 고친 말"], targets:[{label:"ⓐ",text:"The annual Riverdale Science Fair will hold on July 18"},{label:"ⓑ",text:"submitting"}] },
  278: { kind:"arrangement", title:"밑줄 친 (A)의 우리말과 같은 뜻이 되도록 주어진 말을 알맞게 배열하세요.", slotLabels:["완성 문장"], conditions:["필요하면 형태를 바꿀 것"], wordBank:["take","more of you","encourage","like","part","we","would"] },
  279: { kind:"sentence", title:"밑줄 친 (B)의 우리말을 조건에 맞게 영작하세요.", slotLabels:["완성 문장"], conditions:["주어진 단어와 표현을 사용할 것","필요하면 형태를 바꿀 것","17단어로 쓸 것"], wordBank:["related to","renewable energy","a project","model","environmental conservation","experiment","invite","present"] },
  280: { kind:"correction", title:"밑줄 친 ⓐ, ⓑ의 어색한 부분을 고친 뒤 각각 전체를 다시 쓰세요.", slotLabels:["ⓐ 고친 전체 표현","ⓑ 고친 전체 표현"], conditions:["단어를 추가하지 말 것"], targets:[{label:"ⓐ",text:"she couldn’t understand that she saw"},{label:"ⓑ",text:"Known she had chosen a quality bakery"}] },
  281: { kind:"sentence", title:"밑줄 친 (A)의 우리말을 조건에 맞게 영작하세요.", slotLabels:["완성 문장"], conditions:["She로 시작할 것","분사구문을 사용할 것","주어진 말을 사용하고 필요하면 변형할 것","9단어로 쓸 것"], wordBank:["make","order","a mistake","if","wonder","when"] },
  282: { kind:"sentence", title:"밑줄 친 (B)의 우리말을 조건에 맞게 영작하세요.", slotLabels:["완성 문장"], conditions:["He로 시작할 것","분사구문을 사용할 것","과거완료를 사용할 것","주어진 말을 사용하고 필요하면 변형할 것","12단어로 쓸 것"], wordBank:["explain","with","receive","similar","return"] },
  283: { kind:"multi-correction", title:"밑줄 친 ⓐ~ⓔ 중 어법상 어색한 두 곳을 찾아 알맞게 고쳐 쓰세요.", conditions:["기호와 고친 표현을 함께 쓸 것"], targets:[{label:"ⓐ",text:"that"},{label:"ⓑ",text:"assuming"},{label:"ⓒ",text:"how"},{label:"ⓓ",text:"collating"},{label:"ⓔ",text:"is composed"}] },
  284: { kind:"sentence", title:"밑줄 친 (A)의 우리말을 조건에 맞게 영작하세요.", slotLabels:["완성 문장"], conditions:["명사절 접속사 that을 사용할 것","목적격 관계대명사를 생략할 것","주어진 말을 사용하고 필요하면 변형할 것","12단어로 쓸 것"], wordBank:["efficient","on board","productive","everyone","you’ve","know","bring"] },
  285: { kind:"sentence", title:"밑줄 친 (B)의 우리말을 조건에 맞게 영작하세요.", slotLabels:["완성 문장"], conditions:["접속사를 남긴 분사구문을 주절 앞에 쓸 것","명사(구)를 수식하는 분사를 사용할 것","주어진 말을 사용하고 필요하면 변형할 것","19단어로 쓸 것"], wordBank:["a common goal","with","always check","when","the individuals","assemble","as","involve","the overall view","a team","well"] },
  286: { kind:"correction", title:"밑줄 친 ⓐ, ⓑ의 어색한 부분을 각각 알맞게 고쳐 쓰세요.", slotLabels:["ⓐ 고친 말","ⓑ 고친 말"], targets:[{label:"ⓐ",text:"which"},{label:"ⓑ",text:"such internally generating representations"}] },
  287: { kind:"sentence", title:"밑줄 친 (A)의 우리말을 조건에 맞게 영어 문장으로 완성하세요.", slotLabels:["완성 문장"], conditions:["명사(구)를 수식하는 분사를 사용할 것","명사절 접속사 that을 사용할 것","the same A as B를 사용할 것","주어진 말을 사용하고 필요하면 변형할 것"], wordBank:["even hints","there","regions","a scene","use","show","be"] },
  288: { kind:"sentence", title:"밑줄 친 (B)의 우리말을 조건에 맞게 영어 문장으로 완성하세요.", slotLabels:["완성 문장"], conditions:["가정법 과거를 사용할 것","주어진 말을 사용하고 필요하면 변형할 것"], wordBank:["of the world","internal model","hungry","a perfect substitute","simply imagine","can"] },
  289: { kind:"correction", title:"밑줄 친 ⓐ~ⓒ의 어색한 부분을 각각 알맞게 고쳐 쓰세요.", slotLabels:["ⓐ 고친 말","ⓑ 고친 말","ⓒ 고친 말"], targets:[{label:"ⓐ",text:"Events what could happen but aren’t likely"},{label:"ⓑ",text:"people who play the lottery is often optimistic"},{label:"ⓒ",text:"the odds of a single ticket wins the largest, most popular U.S. lotteries"}] },
  290: { kind:"sentence", title:"밑줄 친 (A)의 우리말을 조건에 맞게 영작하세요.", slotLabels:["완성 문장"], conditions:["주격 관계대명사 that을 사용할 것","주어진 말을 사용하고 필요하면 변형할 것","21단어로 쓸 것"], wordBank:["have","a five-percent chance","could subjectively seem like","of occurring","it","an objective one-percent chance","an event"] },
  291: { kind:"sentence", title:"밑줄 친 (B)의 우리말을 조건에 맞게 영작하세요.", slotLabels:["완성 문장"], conditions:["the+비교급, the+비교급 구문을 사용할 것","주어진 말을 사용하고 필요하면 변형할 것","10단어로 쓸 것"], wordBank:["small","the probability","much","overestimate","likelihood"] },
  292: { kind:"multi-correction", title:"밑줄 친 ⓐ~ⓔ 중 어법상 어색한 두 곳을 찾아 알맞게 고쳐 쓰세요.", conditions:["기호와 고친 표현을 함께 쓸 것"], targets:[{label:"ⓐ",text:"exists"},{label:"ⓑ",text:"getting products to market at competitive prices"},{label:"ⓒ",text:"hedging funds"},{label:"ⓓ",text:"unifying some of the currencies"},{label:"ⓔ",text:"growing"}] },
  293: { kind:"sentence", title:"밑줄 친 (A)의 우리말을 조건에 맞게 영어 문장으로 완성하세요.", slotLabels:["완성 문장"], conditions:["동명사 주어를 사용할 것","명사절 접속사 that을 사용할 것","주어진 말을 사용하고 필요하면 변형할 것"], wordBank:["disappear","have","mean","reinvest","those transaction costs","the savings","a common currency","can"] },
  294: { kind:"arrangement", title:"빈칸 (B)에 들어갈 문장이 되도록 주어진 말을 알맞게 배열하세요.", slotLabels:["완성 문장"], wordBank:["that","provides for","a common currency","a strong economic foundation","can benefit from","all"] },
  295: { kind:"correction", title:"밑줄 친 ⓐ~ⓒ의 어색한 부분을 각각 알맞게 고쳐 쓰세요.", slotLabels:["ⓐ 고친 말","ⓑ 고친 말","ⓒ 고친 말"], targets:[{label:"ⓐ",text:"that glows in the Orion constellation"},{label:"ⓑ",text:"is even further away"},{label:"ⓒ",text:"what we have a chance of understanding the history of the universe"}] },
  296: { kind:"sentence", title:"밑줄 친 (A)의 우리말을 조건에 맞게 영어 문장으로 완성하세요.", slotLabels:["완성 문장"], conditions:["the+비교급, the+비교급 구문을 사용할 것","주어진 말을 사용하고 필요하면 변형할 것","각 빈칸에 한 단어씩 쓸 것"], wordBank:["can","from","look","light","collect","further"] },
  297: { kind:"sentence", title:"밑줄 친 (B)의 우리말을 조건에 맞게 영어 문장으로 완성하세요.", slotLabels:["완성 문장"], conditions:["현재완료를 사용할 것","부사적 용법의 to부정사를 사용할 것","주어진 말을 사용할 것","각 빈칸에 한 단어씩 쓸 것"], wordBank:["to","at least 1,000 years","familiar","have","reach","travel","light"] },
  298: { kind:"correction", title:"밑줄 친 ⓐ, ⓑ의 어색한 부분을 고친 뒤 각각 전체를 다시 쓰세요.", slotLabels:["ⓐ 고친 전체 표현","ⓑ 고친 전체 표현"], conditions:["ⓐ에는 단어를 추가하지 말 것"], targets:[{label:"ⓐ",text:"is known for vivid scenes of African-American history and daily life"},{label:"ⓑ",text:"most of them lost"}] },
  299: { kind:"sentence", title:"밑줄 친 (A)의 우리말을 조건에 맞게 영어 문장으로 완성하세요.", slotLabels:["완성 문장"], conditions:["분사구문을 사용할 것","주어진 말을 사용하고 필요하면 변형할 것","각 빈칸에 한 단어씩 쓸 것"], wordBank:["move to","born","Atlantic City","study","Harlem","art"] },
  300: { kind:"sentence", title:"밑줄 친 (B)의 우리말을 조건에 맞게 영작하세요.", slotLabels:["완성 문장"], conditions:["명사를 부연 설명하는 분사구를 사용할 것","동사+간접목적어+직접목적어 구조를 사용할 것","주어진 말을 사용하고 필요하면 변형할 것","13단어로 쓸 것"], wordBank:["bring","masterpiece","widely regard","national recognition"] },
  343: { kind:"summary", title:"요약문의 빈칸에 들어갈 말을 지문에서 찾아 한 단어씩 쓰세요.", slotLabels:["빈칸 1","빈칸 2","빈칸 3"] },
  344: { kind:"summary", title:"요약문의 빈칸에 들어갈 말을 지문에서 찾아 한 단어씩 쓰세요." },
  345: { kind:"summary", title:"요약문의 빈칸에 들어갈 말을 지문에서 찾아 한 단어씩 쓰세요." },
  346: { kind:"summary", title:"요약문의 빈칸에 들어갈 말을 지문에서 찾아 한 단어씩 쓰세요." },
  347: { kind:"summary", title:"요지문의 빈칸에 들어갈 말을 지문에서 찾아 한 단어씩 쓰세요.", slotLabels:["빈칸 1","빈칸 2","빈칸 3"] },
  348: { kind:"summary", title:"요약문의 빈칸에 들어갈 말을 지문에서 찾아 한 단어씩 쓰세요." },
  349: { kind:"summary", title:"요약문의 빈칸에 들어갈 말을 지문에서 찾아 한 단어씩 쓰세요.", slotLabels:["빈칸 1","빈칸 2","빈칸 3"] },
  350: { kind:"summary", title:"제목의 빈칸에 들어갈 말을 지문에서 찾아 한 단어씩 쓰세요.", slotLabels:["빈칸 1","빈칸 2"] },
};
function publicWritingGuide(questionNo: number | null) { return questionNo ? WRITING_GUIDE_REPAIRS[questionNo] || null : null; }
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
  };
  return guide.title || guide.slotLabels.length || guide.conditions.length || guide.wordBank.length || guide.targets.length || guide.taskText ? guide : null;
}
function cleanQuestionText(value: unknown) {
  return clean(value, 30_000)
    .replace(/^\s*(?:[※]\s*)?다음\s*(?:글|대화)(?:을|를)\s*읽고\s*(?:다음\s*)?물음에\s*답하시오\s*[.!?]?\s*/u, "")
    .replace(/\s+/g, " ").trim();
}
function normalizedCombination(value: unknown) { return clean(value, 1_000).normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function choicesMatchGroups(groups: Array<{ label: string; options: string[] }>, choices: string[]) {
  if (!groups.length || !choices.length) return false;
  const combinations = new Set<string>();
  function visit(index: number, parts: string[]) {
    if (index === groups.length) { combinations.add(normalizedCombination(parts.join(" "))); return; }
    for (const option of groups[index].options) visit(index + 1, [...parts, option]);
  }
  visit(0, []);
  return choices.every(choice => combinations.has(normalizedCombination(choice)));
}
function inlineAnswer(payload: any, choiceCount: number) {
  const groups = inlineOptionGroups(payload?.variant_text), answer = answerIndexes(payload?.answer, choiceCount);
  if (!groups.length || answer.length !== 1) return [];
  const expected = normalizedCombination(payload?.choices?.[answer[0]]), selected: number[] = [];
  function visit(index: number, parts: string[]): boolean {
    if (index === groups.length) return normalizedCombination(parts.join(" ")) === expected;
    for (let option = 0; option < groups[index].options.length; option += 1) {
      if (visit(index + 1, [...parts, groups[index].options[option]])) { selected[index] = option; return true; }
    }
    return false;
  }
  return visit(0, []) ? selected : [];
}
function inferredChoiceParts(payload: any, choices: string[]) {
  const prompt = clean(payload?.prompt, 1_000), labels = [...new Set(prompt.match(/\([A-H]\)/g) || [])];
  if (labels.length < 2 || labels.length > 4 || choices.length < 2) return [];
  const parts = choices.map(choice => choice.split(/\s+/).filter(Boolean));
  // Only infer an unambiguous table: every row must contain exactly one cell
  // for every labelled blank. Multi-word cells remain importer-owned data.
  return parts.every(row => row.length === labels.length) ? parts : [];
}
function publicQuestion(row: any, passageText = "", studentState: { bookmarked?: boolean; lastResult?: boolean | null } = {}) {
  const payload = row.payload || {}, type = clean(row.type, 40), sourceQuestionNo = Number(payload.source?.source_question_no) || null;
  const specValidation = validateQuestionSpec(payload, type, row.status || "available"), renderSpec = specValidation.spec;
  // Legacy repairs belong to one named workbook. A bare source question number
  // is not a global identity: every new PDF also has a question 1, 2, 3, ...
  const legacyWorkbook = /2026\s*[-년]?\s*0?6|부산/.test(clean(payload.source?.exam, 160));
  let writingGuide = publicStoredWritingGuide(payload.writing_guide) || (legacyWorkbook ? publicWritingGuide(sourceQuestionNo) : null);
  const rawChoices = Array.isArray(payload.choices) ? payload.choices.map((item: unknown) => clean(item, 1_000)).filter(Boolean) : [];
  const storedChoiceParts = publicChoiceParts(payload.choice_parts), repairedChoiceParts = legacyWorkbook && sourceQuestionNo ? CHOICE_PART_REPAIRS[sourceQuestionNo] || [] : [];
  const choiceParts = storedChoiceParts.length ? storedChoiceParts : repairedChoiceParts.length ? repairedChoiceParts : inferredChoiceParts(payload, rawChoices);
  const choices = choiceParts.length ? choiceParts.map(parts => parts.join(" ")) : rawChoices;
  if (type === "multiple_choice" && (choices.length < 2 || choices.length > 8)) throw new ApiError(500, "문제 선택지 형식이 올바르지 않습니다.");
  if (!["multiple_choice", "written_response"].includes(type)) throw new ApiError(500, "지원하지 않는 문제 형식입니다.");
  const acceptedKey = "accepted" + "_answers", answerKey = "ans" + "wer";
  const acceptedSlots = Array.isArray(payload[acceptedKey]) ? payload[acceptedKey] : [];
  // Slot counts derived from the private answer key are validation metadata,
  // never student hints. Explicit word-count conditions remain in writingGuide.
  const storedResponseSlots = (Array.isArray(payload.response_slots) ? payload.response_slots : []).slice(0, 12).map((slot: any, index: number) => ({ label: clean(slot?.label, 80) || `답 ${index + 1}` }));
  const guideSlots = writingGuide?.slotLabels?.map((label: string) => ({ label })) || [];
  const responseSlots = storedResponseSlots.length && guideSlots.length !== storedResponseSlots.length ? storedResponseSlots : guideSlots.length ? guideSlots : storedResponseSlots;
  const storedSkill = clean(payload.skill, 40);
  let skill = /요약/.test(clean(payload.prompt, 1_000)) ? "summary" : sourceQuestionNo === 125 ? "vocabulary" : storedSkill;
  const detectedGroups = type === "multiple_choice" ? inlineOptionGroups(payload.set_text || payload.variant_text) : [];
  const inlineGroups = choicesMatchGroups(detectedGroups, choices) ? detectedGroups : [];
  if (inlineGroups.length && !["grammar", "vocabulary"].includes(skill)) skill = /흐름상|문맥상/.test(clean(payload.prompt, 1_000)) ? "vocabulary" : "grammar";
  const storedTargets = publicTargetRanges(payload.target_ranges);
  const rawTargetRanges = legacyWorkbook && sourceQuestionNo && TARGET_RANGE_REPAIRS[sourceQuestionNo] ? TARGET_RANGE_REPAIRS[sourceQuestionNo].map(item => ({ ...item, canonicalText: item.canonicalText || item.text })) : storedTargets;
  const targetRanges = expandedTargetRanges(rawTargetRanges, passageText);
  if (writingGuide) {
    const correction = /correction/.test(writingGuide.kind);
    if (correction && !writingGuide.targets?.length) writingGuide = { ...writingGuide, targets: targetRanges };
    if (!writingGuide.taskText && ["sentence", "arrangement"].includes(writingGuide.kind)) writingGuide = { ...writingGuide, taskText: koreanTaskText(payload.set_text || payload.variant_text) };
  }
  // Keep answering deliberately plain: the passage may point at evidence, but
  // every multiple-choice answer is selected from the normal choice list.
  const interaction = "choices";
  const summaryText = clean(payload.summary_text, 10_000) || (legacyWorkbook && sourceQuestionNo ? SUMMARY_REPAIRS[sourceQuestionNo] || "" : "");
  if (summaryText && !renderSpec.extras.includes("summary")) renderSpec.extras = [...renderSpec.extras, "summary"];
  const inferredMultiSelect = type === "multiple_choice" && Array.isArray(payload[answerKey]) && payload[answerKey].length > 1;
  return {
    id: row.id, type, family: clean(payload.family, 40) || (type === "written_response" ? "written" : "standard"), skill,
    taxonomy: renderSpec.taxonomy, renderer: renderSpec.renderer, renderSpec, importStatus: renderSpec.importStatus,
    prompt: clean(payload.prompt, 1_000), choices, choiceParts, multiSelect: payload.multi_select === true || inferredMultiSelect, responseType: type === "written_response" ? "written" : "choice", responseSlots, writingGuide,
    passageText: cleanQuestionText(passageText), setText: cleanQuestionText(payload.set_text) || null, variantText: cleanQuestionText(payload.variant_text) || null,
    variantMode: payload.variant_mode === "authored_variant" ? "authored_variant" : "canonical_overlay",
    variantSegments: publicSegments(payload.variant_segments), contentBlocks: publicBlocks(payload.content_blocks),
    stimulus: clean(payload.stimulus, 10_000), summaryText, interaction, inlineGroups, targetRanges,
    bookmarked: studentState.bookmarked === true, lastResult: typeof studentState.lastResult === "boolean" ? studentState.lastResult : null,
    source: payload.source ? { exam: clean(payload.source.exam, 160), passageNo: Number(payload.source.passage_no) || null, questionNo: sourceQuestionNo, section: clean(payload.source.section, 20), setId: clean(payload.source.set_id, 120) || null } : null,
  };
}
function isReadyQuestion(row: any) { return validateQuestionSpec(row?.payload || {}, clean(row?.type, 40), row?.status || "available").ready; }
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
  if (!questionIds.length) return { items: [] };
  const unresolvedRows = rows<any[]>(await db.from("ready_questions").select("id,passage_id,type,payload,status,created_at").in("id", questionIds).in("type", ["multiple_choice", "written_response"]).eq("status", "available"));
  if (!unresolvedRows.length) return { items: [] };
  const passageIds = [...new Set(unresolvedRows.map(question => question.passage_id))];
  const questionRows = rows<any[]>(await db.from("ready_questions").select("id,passage_id,type,payload,status,created_at").in("passage_id", passageIds).in("type", ["multiple_choice", "written_response"]).eq("status", "available"));
  const sentenceRows = rows<any[]>(await db.from("ready_passage_sentences").select("passage_id,sentence_index,text").in("passage_id", passageIds).order("sentence_index"));
  const passageRows = rows<any[]>(await db.from("ready_passages").select("id,title,source_type,source_label").in("id", passageIds));
  const passages = new Map(passageRows.map(passage => [passage.id, passage]));
  const passageText = new Map<string, string>();
  for (const passageId of passageIds) passageText.set(passageId, sentenceRows.filter(sentence => sentence.passage_id === passageId).map(sentence => sentence.text).join(" "));
  const review = new Set(questionIds), latest = await latestAttemptResults(student.id, examId);
  const bookmarkRows = rows<any[]>(await db.from("ready_question_bookmarks").select("question_id").eq("student_id", student.id).eq("exam_id", examId));
  const bookmarks = new Set(bookmarkRows.map(item => item.question_id));
  const normalizedQuestions = passageIds.flatMap(passageId => normalizeMainTextQuestionRows(questionRows.filter(row => row.passage_id === passageId), passages.get(passageId), passageText.get(passageId) || ""));
  normalizedQuestions.sort((a, b) => (Number(a.payload?.source?.passage_no) || 0) - (Number(b.payload?.source?.passage_no) || 0) || (Number(a.payload?.position) || 0) - (Number(b.payload?.position) || 0));
  return { items: normalizedQuestions.filter(row => review.has(row.id) && isReadyQuestion(row) && isMainTextQuestion(row, passages.get(row.passage_id), passageText.get(row.passage_id) || "")).map(row => ({ question: publicQuestion(row, passageText.get(row.passage_id) || "", { bookmarked: bookmarks.has(row.id), lastResult: latest.get(row.id) }) })) };
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
  return { bookmarked, reviewCount: (await eligibleReviewQuestionIds(student.id, examId)).length };
}
async function submitAttempt(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), questionId = required(body.questionId, "문제", 80);
  const question = rows<any>(await db.from("ready_questions").select("id,passage_id,type,payload,status").eq("id", questionId).in("type", ["multiple_choice", "written_response"]).eq("status", "available").maybeSingle());
  if (!question) throw new ApiError(404, "현재 풀 수 없는 문제입니다.");
  if (!isReadyQuestion(question)) throw new ApiError(409, "검수가 끝나지 않은 문제입니다.");
  await studentPassageAccess(examId, question.passage_id, student);
  const spec = publicQuestion(question); let response: any, answer: any, correct = false, aiFeedback = "", aiRequestId: string | null = null;
  if (question.type === "multiple_choice") {
    if (spec.interaction === "inline_options") {
      const selected = Array.isArray(body.inlineSelected) ? body.inlineSelected.map(Number) : [], expected = inlineAnswer(question.payload, spec.choices.length);
      if (selected.length !== spec.inlineGroups.length || selected.some((value: number, index: number) => !Number.isInteger(value) || value < 0 || value >= spec.inlineGroups[index].options.length)) throw new ApiError(400, "본문의 모든 단어를 선택해 주세요.");
      if (expected.length !== selected.length) throw new ApiError(500, "본문 선택형 정답을 해석하지 못했습니다.");
      correct = selected.every((value: number, index: number) => value === expected[index]); response = { inlineSelected: selected }; answer = expected;
    } else {
      const selected = answerIndexes(body.selected, spec.choices.length); answer = answerIndexes(question.payload?.answer, spec.choices.length);
      if (!spec.multiSelect && selected.length !== 1) throw new ApiError(400, "답을 하나만 선택해 주세요.");
      correct = selected.length === answer.length && selected.every((value, index) => value === answer[index]); response = { selected };
    }
  } else {
    const responses = cleanList(body.responses, 12, 2_000), accepted = Array.isArray(question.payload?.accepted_answers) ? question.payload.accepted_answers : [];
    if (!responses.length || responses.length !== accepted.length) throw new ApiError(400, "모든 답을 입력해 주세요.");
    const normalize = (value: unknown) => clean(value, 2_000).normalize("NFKC").toLowerCase().replace(/[“”‘’'".,!?;:()[\]{}]/g, "").replace(/\s+/g, " ").trim();
    const acceptedSets = Array.isArray(question.payload?.accepted_response_sets) ? question.payload.accepted_response_sets : [];
    correct = acceptedSets.length
      ? acceptedSets.some((set: unknown) => Array.isArray(set) && set.length === responses.length && set.every((candidate, index) => normalize(candidate) === normalize(responses[index])))
      : responses.every((value, index) => (Array.isArray(accepted[index]) ? accepted[index] : [accepted[index]]).some((candidate: unknown) => normalize(candidate) === normalize(value)));
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
  return { attempt, correct, answer: correct ? null : answer, explanation, aiFeedback, aiRequestId, bookmarked: !!bookmark.data, reviewCount: (await eligibleReviewQuestionIds(student.id, examId)).length };
}

function workbookForPassage(passage: any) {
  const identity = [passage?.title, passage?.source_label].map(value => clean(value, 300)).join(" ");
  return /(?:민병천|NE\s*능률)/i.test(identity) && /(?:Lesson|레슨|제)\s*1|1\s*과/i.test(identity)
    ? NE_MINBYEONGCHEON_L1_WORKBOOK
    : null;
}
function workbookItem(catalog: any, itemKey: string) {
  return catalog?.stages?.flatMap((stage: any) => stage.items || []).find((item: any) => item.key === itemKey) || null;
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
  const latest = new Map<string, boolean>();
  for (const attempt of attempts) if (!latest.has(attempt.item_key)) latest.set(attempt.item_key, attempt.correct === true);
  const stages = catalog.stages.map((stage: any) => ({
    stage: stage.stage, title: stage.title, instruction: stage.instruction,
    locked: stage.stage === 2, lockReason: stage.stage === 2 ? "AI 채점 준비 중" : "",
    total: stage.items.length,
    attempted: stage.items.filter((item: any) => latest.has(item.key)).length,
    completed: stage.items.filter((item: any) => latest.get(item.key) === true).length,
    items: stage.items.map((item: any) => ({
      key: item.key, stage: item.stage, number: item.number, kind: item.kind || "blank_input",
      source: item.source, prompt: item.prompt, slotCount: item.answers.length,
      hints: Array.isArray(item.hints) ? item.hints : [],
      groups: Array.isArray(item.groups) ? item.groups : [],
      pairCount: Number(item.pairCount) || 0, subtype: clean(item.subtype, 40),
      completed: latest.get(item.key) === true,
    })),
  }));
  return { workbookKey: catalog.workbookKey, title: catalog.title, passage: { id: passage.id, title: passage.title }, stages };
}
async function submitWorkbookAttempt(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), passageId = required(body.passageId, "지문", 80), itemKey = required(body.itemKey, "워크북 문제", 120);
  const passage = await studentPassageAccess(examId, passageId, student), catalog = workbookForPassage(passage), item = workbookItem(catalog, itemKey);
  if (!catalog || !item) throw new ApiError(404, "현재 풀 수 없는 워크북 문제입니다.");
  if (item.stage === 2) throw new ApiError(409, "2단계는 채점 준비 중입니다.");
  const responses = cleanList(body.responses, 12, 1_000);
  if (responses.length !== item.answers.length) throw new ApiError(400, "모든 빈칸을 입력해 주세요.");
  const slotResults = responses.map((response, index) => normalizeWorkbookAnswer(response) === normalizeWorkbookAnswer(item.answers[index]));
  const correct = slotResults.every(Boolean);
  const inserted = rows<any>(await db.from("ready_workbook_attempts").insert({
    student_id: student.id, exam_id: examId, passage_id: passageId, workbook_key: catalog.workbookKey,
    item_key: item.key, stage: item.stage, response: { responses }, correct,
  }).select("id,correct,created_at").single());
  return { attempt: inserted, correct, answers: item.answers, slotResults };
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
    case "student_bootstrap": return studentBootstrap(session as ReadySession); case "student_passage": return studentPassage(body, session as ReadySession); case "student_questions": return studentQuestions(body, session as ReadySession); case "student_review_questions": return studentReviewQuestions(body, session as ReadySession); case "set_question_bookmark": return setQuestionBookmark(body, session as ReadySession); case "submit_attempt": return submitAttempt(body, session as ReadySession); case "student_workbook": return studentWorkbook(body, session as ReadySession); case "submit_workbook_attempt": return submitWorkbookAttempt(body, session as ReadySession);
    default: throw new ApiError(404, "알 수 없는 READY 작업입니다.");
  }
}
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS }); if (req.method !== "POST") return json({ error: "POST만 받습니다." }, 405);
  try { const body = await req.json(), op = clean(body?.op, 60); let session: ReadySession | null = null; if (adminOps.has(op)) session = await authenticate(req, "admin"); else if (studentOps.has(op)) session = await authenticate(req, "student"); else if (op === "logout") session = await authenticate(req); else if (!publicOps.has(op)) throw new ApiError(404, "알 수 없는 READY 작업입니다."); return json(await dispatch(op, body, session)); }
  catch (error) { console.error(error); return error instanceof ApiError ? json({ error: error.message, detail: error.detail }, error.status) : json({ error: "READY 서버에서 요청을 처리하지 못했습니다." }, 500); }
});
