// READY — sentence-ordering practice API (steps 1 and 2).
// Custom opaque sessions are validated here. Deploy this Edge Function with JWT verification disabled.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { bearerToken, randomSessionToken, secureEqual, sha256Hex } from "./auth-core.mjs";
import { gradeSentenceAttempt, practiceItems, practiceProgressKey, SENTENCE_PRACTICE_CONTRACT, SENTENCE_PRACTICE_WORKBOOK_KEY } from "../../ready/sentence-practice.js";
import { workbookProgressPercent } from "../../ready/workbook-progress.js";

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
const adminOps = new Set(["teacher_bootstrap", "create_student", "set_student_code", "delete_student", "create_passage", "passage_editor", "save_passage", "delete_passage", "delete_impact", "set_scope_passages", "admin_learning_progress"]);
const studentOps = new Set(["student_bootstrap_active", "student_passage", "submit_sentence_attempts"]);
const publicOps = new Set(["student_login", "admin_login"]);
export const READY_OPS = Object.freeze([...publicOps, "logout", ...studentOps, ...adminOps]);
const PRACTICE_STEPS = [1, 2];
const LAST_SEEN_INTERVAL_MS = 5 * 60_000;
// Installed native apps and open tabs can still run the removed Reader /
// Workbook / Question client, so unknown operations say how to recover.
const UNKNOWN_OP = "지원하지 않는 READY 작업입니다. 화면을 새로고침하거나 앱을 업데이트해 주세요.";

type ReadySession = { id: string; actor_type: "student" | "admin"; student_id: string | null; remembered: boolean; expires_at: string };
type Student = { id: string; name: string; school: string; grade: string };
class ApiError extends Error { constructor(public status: number, message: string, public detail?: unknown) { super(message); } }
function clean(value: unknown, max = 10_000) { return String(value ?? "").replace(/\u0000|[\uD800-\uDFFF]/g, "").trim().slice(0, max); }
function required(value: unknown, name: string, max = 10_000) { const out = clean(value, max); if (!out) throw new ApiError(400, `${name} 값이 필요합니다.`); return out; }
function rows<T>(result: { data: T | null; error: { message: string } | null }): T { if (result.error) throw new ApiError(500, result.error.message); return result.data as T; }
function ids(value: unknown) { return Array.isArray(value) ? [...new Set(value.map(item => clean(item, 80)).filter(Boolean))] : []; }
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// PostgREST caps every select at `max-rows` (1000 by default) without an
// error. Lists that can grow past that are read page by page until the exact
// count is reached, which works whatever max-rows is configured to. Callers
// must give a total order so pages do not overlap.
const PAGE_SIZE = 1000;
async function allRows<T>(table: string, columns: string, apply: (query: any) => any): Promise<T[]> {
  const output: T[] = [];
  for (let from = 0; ;) {
    const result = await apply(db.from(table).select(columns, { count: "exact" })).range(from, from + PAGE_SIZE - 1);
    const batch = rows<T[]>(result) || [], total = typeof result.count === "number" ? result.count : (batch.length < PAGE_SIZE ? output.length + batch.length : Infinity);
    output.push(...batch); from += batch.length;
    if (!batch.length || output.length >= total) return output;
  }
}

// ---------- Sessions and login ----------
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
  const result = await db.from("ready_sessions").select("id,actor_type,student_id,remembered,expires_at,last_seen_at").eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (result.error) throw new ApiError(500, result.error.message);
  if (!result.data || (actor && result.data.actor_type !== actor)) throw new ApiError(401, "세션이 만료되었거나 권한이 없습니다.");
  const { last_seen_at: lastSeenAt, ...session } = result.data as ReadySession & { last_seen_at?: string };
  // One write per request was the main per-call DB cost; minute precision is enough.
  if (!lastSeenAt || Date.now() - Date.parse(lastSeenAt) > LAST_SEEN_INTERVAL_MS) await db.from("ready_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", session.id);
  return session as ReadySession;
}
async function createSession(actorType: "student" | "admin", studentId: string | null, remember = false) {
  const token = randomSessionToken(), tokenHash = await sha256Hex(token);
  const hours = actorType === "admin" ? 8 : (remember ? 24 * 30 : 12);
  const expiresAt = new Date(Date.now() + hours * 3_600_000).toISOString();
  const result = await db.from("ready_sessions").insert({ token_hash: tokenHash, actor_type: actorType, student_id: studentId, remembered: actorType === "student" && remember, expires_at: expiresAt });
  if (result.error) throw new ApiError(500, result.error.message);
  return { token, expiresAt, remember: actorType === "student" && remember };
}
async function assertLoginAllowed(identifier: string, limit = 5) {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const result = await db.from("ready_login_attempts").select("id", { count: "exact", head: true }).eq("identifier", identifier).eq("successful", false).gte("created_at", cutoff);
  if (result.error) throw new ApiError(500, result.error.message);
  if ((result.count || 0) >= limit) throw new ApiError(429, "로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요.");
}
async function recordLogin(identifiers: string | string[], successful: boolean) { const list = Array.isArray(identifiers) ? identifiers : [identifiers]; const result = await db.from("ready_login_attempts").insert(list.map(identifier => ({ identifier, successful }))); if (result.error) console.error("ready_login_attempts:", result.error.message); }
// Login throttling per client. The per-code key alone never limits someone
// trying a different code each time, and a single global admin key let anyone
// lock the teacher out. The IP is stored only as a peppered hash. A classroom
// behind one NAT shares an IP, so the student limit is generous.
const STUDENT_FAILURES_PER_CLIENT = 30, ADMIN_FAILURES_PER_CLIENT = 5, ADMIN_FAILURES_GLOBAL = 50;
async function clientKey(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
  return (await sha256Hex(`${Deno.env.get("READY_STUDENT_CODE_PEPPER") || supabaseAdminKey()}:ready-login-client-v1:${ip}`)).slice(0, 24);
}
async function revokeSession(session: ReadySession) { const result = await db.from("ready_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", session.id); if (result.error) throw new ApiError(500, result.error.message); return { loggedOut: true }; }

function validStudentCode(value: string) { return /^\d{6}$/.test(value); }
async function studentCodeFingerprint(code: string) {
  const pepper = Deno.env.get("READY_STUDENT_CODE_PEPPER") || supabaseAdminKey();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${pepper}:ready-student-code-v1`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(code));
  return [...new Uint8Array(signature)].map(value => value.toString(16).padStart(2, "0")).join("");
}
function codeRpcError(error: { message: string } | null) { if (!error) return; if (/이미 사용 중인 학생 코드|unique/i.test(error.message)) throw new ApiError(409, "이미 사용 중인 학생 코드입니다."); throw new ApiError(500, error.message); }
async function studentLogin(body: any, req: Request) {
  const code = clean(body.code, 10); if (!validStudentCode(code)) throw new ApiError(400, "학생 코드는 숫자 6자리입니다.");
  const client = `student-client:${await clientKey(req)}`; await assertLoginAllowed(client, STUDENT_FAILURES_PER_CLIENT);
  const fingerprint = await studentCodeFingerprint(code), identifier = `student-code:${fingerprint.slice(0, 16)}`; await assertLoginAllowed(identifier);
  const verified = await db.rpc("ready_verify_student_code", { p_code_fingerprint: fingerprint, p_code: code });
  if (verified.error) throw new ApiError(500, verified.error.message);
  const studentId = clean(verified.data, 80), ok = !!studentId; await recordLogin(ok ? identifier : [identifier, client], ok); if (!ok) throw new ApiError(401, "학생 코드를 확인해 주세요.");
  const student = rows<any>(await db.from("ready_students").select("id,name,school,grade").eq("id", studentId).eq("active", true).single());
  return { session: await createSession("student", student.id, body.remember === true), student };
}
async function adminLogin(body: any, req: Request) {
  const expected = Deno.env.get("READY_ADMIN_PASSWORD") || ""; if (!expected) throw new ApiError(503, "READY_ADMIN_PASSWORD가 서버에 설정되지 않았습니다.");
  const client = `admin-client:${await clientKey(req)}`;
  await assertLoginAllowed(client, ADMIN_FAILURES_PER_CLIENT); await assertLoginAllowed("admin", ADMIN_FAILURES_GLOBAL);
  const supplied = String(body.password ?? "").slice(0, 200), ok = supplied.length > 0 && secureEqual(supplied, expected);
  await recordLogin(ok ? "admin-success" : ["admin", client], ok); if (!ok) throw new ApiError(401, "관리자 비밀번호가 맞지 않습니다.");
  return { session: await createSession("admin", null, false) };
}

// ---------- Admin: students ----------
async function createStudent(body: any) {
  const name = required(body.name, "학생 이름", 40), school = required(body.school, "학교", 80), grade = required(body.grade, "학년", 40), code = clean(body.code, 10);
  if ((school === "test" && grade !== "1학년") || (school === "test2" && grade !== "2학년")) throw new ApiError(400, "QA 학교와 학년 조합을 확인해 주세요.");
  if (!validStudentCode(code)) throw new ApiError(400, "학생 코드는 숫자 6자리여야 합니다.");
  const result = await db.rpc("ready_create_student_with_code", { p_name: name, p_school: school, p_grade: grade, p_code: code, p_code_fingerprint: await studentCodeFingerprint(code), p_sort_order: 0 });
  codeRpcError(result.error);
  return { student: rows<any[]>(result)[0] };
}
async function setStudentCode(body: any) { const studentId = required(body.studentId, "학생", 80), code = clean(body.code, 10); if (!validStudentCode(code)) throw new ApiError(400, "학생 코드는 숫자 6자리여야 합니다."); const result = await db.rpc("ready_set_student_code", { p_student_id: studentId, p_code: code, p_code_fingerprint: await studentCodeFingerprint(code) }); codeRpcError(result.error); return { updated: studentId }; }
async function deleteStudent(body: any) {
  const studentId = required(body.studentId, "학생", 80), result = await db.rpc("ready_delete_student_cascade", { p_student_id: studentId });
  if (result.error) throw new ApiError(500, result.error.message); return { deleted: studentId };
}
async function countWhere(table: string, column: string, value: string) {
  const result = await db.from(table).select("*", { count: "exact", head: true }).eq(column, value);
  if (result.error) throw new ApiError(500, result.error.message);
  return result.count || 0;
}
// Deletes are cascades over append-only history, so Admin shows the impact first.
async function deleteImpact(body: any) {
  const targetType = clean(body.targetType, 20), targetId = required(body.targetId, "삭제 대상", 80);
  if (targetType === "student") {
    const student = rows<any>(await db.from("ready_students").select("id,name").eq("id", targetId).maybeSingle());
    if (!student) throw new ApiError(404, "학생을 찾지 못했습니다.");
    return { targetType, targetId, label: student.name, counts: { attempts: await countWhere("ready_workbook_attempts", "student_id", targetId) } };
  }
  if (targetType === "passage") {
    const passage = rows<any>(await db.from("ready_passages").select("id,title").eq("id", targetId).maybeSingle());
    if (!passage) throw new ApiError(404, "문장 세트를 찾지 못했습니다.");
    const [sentences, examLinks, attempts] = await Promise.all([countWhere("ready_passage_sentences", "passage_id", targetId), countWhere("ready_exam_passages", "passage_id", targetId), countWhere("ready_workbook_attempts", "passage_id", targetId)]);
    return { targetType, targetId, label: passage.title, counts: { sentences, examLinks, attempts } };
  }
  throw new ApiError(400, "삭제 대상 종류가 올바르지 않습니다.");
}

// ---------- Admin: sentence sets (Passages) and scopes ----------
async function teacherBootstrap() {
  const [students, exams, passages, examPassages] = await Promise.all([
    allRows<any>("ready_students", "id,name,school,grade,created_at", query => query.order("school").order("grade").order("name").order("id")),
    db.from("ready_exams").select("id,school,grade,title,is_current").eq("is_current", true).order("school").order("grade"),
    allRows<any>("ready_passages", "id,title,source_type,grade,source_year,source_month,source_label,created_at,updated_at,canonical_revision", query => query.order("display_order").order("created_at").order("id")),
    allRows<any>("ready_exam_passages", "exam_id,passage_id,position", query => query.order("position").order("exam_id").order("passage_id")),
  ]);
  return { students, exams: rows(exams), passages, examPassages };
}
function editorRows(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 160) throw new ApiError(400, "문장은 1~160개여야 합니다.");
  return value.map((row: any, index: number) => {
    const text = clean(row?.text, 5001), translation = clean(row?.translation, 5001);
    if (!text || text.length > 5000) throw new ApiError(400, `${index + 1}번 행의 English를 확인해 주세요.`);
    if (!translation || translation.length > 5000) throw new ApiError(400, `${index + 1}번 행의 Korean을 확인해 주세요.`);
    return { id: clean(row?.id, 80) || null, blockType: "SENTENCE", paragraphIndex: 0, text, translation };
  });
}
function passageMeta(body: any) {
  const sourceType = body.sourceType === "MOCK_EXAM" ? "MOCK_EXAM" : "TEXTBOOK", sourceYear = body.sourceYear ? Math.round(Number(body.sourceYear)) : null, sourceMonth = body.sourceMonth ? Math.round(Number(body.sourceMonth)) : null;
  if (sourceType === "MOCK_EXAM" && (!sourceYear || !sourceMonth)) throw new ApiError(400, "모의고사는 연도와 월이 필요합니다.");
  return { title: required(body.title, "문장 세트 제목", 120), grade: required(body.grade, "학년", 40), sourceType, sourceYear, sourceMonth, sourceLabel: clean(body.sourceLabel, 120) };
}
async function createPassage(body: any) {
  const meta = passageMeta(body), sentenceRows = editorRows(body.rows).map(({ text, translation }) => ({ blockType: "SENTENCE", text, translation }));
  const passageId = rows<string>(await db.rpc("ready_create_passage_with_sentences", { p_title: meta.title, p_source_type: meta.sourceType, p_grade: meta.grade, p_source_year: meta.sourceYear, p_source_month: meta.sourceMonth, p_source_label: meta.sourceLabel, p_rows: sentenceRows }));
  return { passageId };
}
async function passageEditor(body: any) {
  const passageId = required(body.passageId, "문장 세트", 80);
  const [passageResult, sentenceResult] = await Promise.all([
    db.from("ready_passages").select("id,title,source_type,grade,source_year,source_month,source_label,canonical_revision,updated_at").eq("id", passageId).maybeSingle(),
    db.from("ready_passage_sentences").select("id,sentence_index,text,translation,block_type,active").eq("passage_id", passageId).eq("active", true).order("sentence_index"),
  ]);
  const passage = rows<any>(passageResult);
  if (!passage) throw new ApiError(404, "문장 세트를 찾지 못했습니다.");
  return { passage, rows: rows<any[]>(sentenceResult).map(row => ({ id: row.id, blockType: row.block_type, text: row.text, translation: row.translation })) };
}
// The editor only shows SENTENCE rows. Legacy sets also carry TITLE/SUBTITLE
// rows and paragraph indexes, so a save re-inserts those rows next to the
// sentence that followed them and keeps each kept sentence's paragraph. New
// sentences join the paragraph of the row before them.
type EditorRow = { id: string | null; blockType: string; paragraphIndex: number; text: string; translation: string };
type StoredRow = { id: string; block_type: string; paragraph_index: number | null; text: string; translation: string | null };
export function mergePassageStructure(current: StoredRow[], next: EditorRow[]): EditorRow[] {
  const kept = new Set(next.map(row => row.id).filter(Boolean)), paragraphById = new Map(current.map(row => [row.id, Number(row.paragraph_index) || 0]));
  const leading: EditorRow[] = [], anchored = new Map<string, EditorRow[]>(), trailing: EditorRow[] = [];
  let seenSentence = false;
  current.forEach((row, index) => {
    if (row.block_type === "SENTENCE") { seenSentence = true; return; }
    const structural = { id: row.id, blockType: row.block_type, paragraphIndex: Number(row.paragraph_index) || 0, text: row.text, translation: row.translation || "" };
    if (!seenSentence) { leading.push(structural); return; }
    const anchor = current.slice(index + 1).find(candidate => candidate.block_type === "SENTENCE" && kept.has(candidate.id));
    if (anchor) anchored.set(anchor.id, [...(anchored.get(anchor.id) || []), structural]); else trailing.push(structural);
  });
  const output = [...leading];
  let paragraph = leading.at(-1)?.paragraphIndex ?? 0;
  for (const row of next) {
    for (const structural of (row.id && anchored.get(row.id)) || []) { output.push(structural); paragraph = structural.paragraphIndex; }
    if (row.id) anchored.delete(row.id);
    if (row.id && paragraphById.has(row.id)) paragraph = paragraphById.get(row.id) as number;
    output.push({ ...row, blockType: "SENTENCE", paragraphIndex: paragraph });
  }
  return [...output, ...trailing];
}
// Existing sentence ids are kept so attempts stay linked; removed rows become inactive.
// `expectedRevision` (sent by the editor) rejects a save based on a stale read.
// The check runs just before the RPC, which locks the row, so a narrow race
// remains until the RPC itself takes the expected revision (see REVIEW.md).
async function savePassage(body: any) {
  const passageId = required(body.passageId, "문장 세트", 80), meta = passageMeta(body), sentenceRows = editorRows(body.rows);
  const [passageResult, currentResult] = await Promise.all([
    db.from("ready_passages").select("id,canonical_revision").eq("id", passageId).maybeSingle(),
    db.from("ready_passage_sentences").select("id,sentence_index,block_type,paragraph_index,text,translation").eq("passage_id", passageId).eq("active", true).order("sentence_index"),
  ]);
  const passage = rows<any>(passageResult);
  if (!passage) throw new ApiError(404, "문장 세트를 찾지 못했습니다.");
  const expected = body.expectedRevision;
  if (expected !== undefined && expected !== null && expected !== "" && Number(expected) !== Number(passage.canonical_revision)) {
    throw new ApiError(409, "다른 곳에서 이 문장 세트가 수정되었습니다. 새로고침한 뒤 다시 저장하세요.", { currentRevision: Number(passage.canonical_revision) });
  }
  const merged = mergePassageStructure(rows<StoredRow[]>(currentResult), sentenceRows);
  if (merged.length > 160) throw new ApiError(400, "제목 행을 포함해 160행을 넘을 수 없습니다.");
  const saved = await db.rpc("ready_save_canonical_passage", { p_passage_id: passageId, p_title: meta.title, p_source_type: meta.sourceType, p_grade: meta.grade, p_source_year: meta.sourceYear, p_source_month: meta.sourceMonth, p_source_label: meta.sourceLabel, p_rows: merged });
  if (saved.error) throw new ApiError(400, saved.error.message);
  return { passageId, revision: Number(saved.data) };
}
async function deletePassage(body: any) {
  const passageId = required(body.passageId, "문장 세트", 80), result = await db.rpc("ready_delete_passage_cascade", { p_passage_id: passageId });
  if (result.error) throw new ApiError(500, result.error.message); return { deleted: passageId };
}
async function setScopePassages(body: any) {
  const school = required(body.school, "학교", 80), grade = required(body.grade, "학년", 40);
  const result = await db.rpc("ready_set_current_scope_passages", { p_school: school, p_grade: grade, p_passage_ids: ids(body.passageIds), p_replace: true });
  if (result.error) throw new ApiError(400, result.error.message);
  return { scopeId: result.data as string };
}

// ---------- Admin: progress summary ----------
// The academy runs on Korean time (UTC+9, no DST) while Edge Functions run in
// UTC, so "today" starts at 00:00 KST, not 00:00 UTC (09:00 KST).
const KST_OFFSET_MS = 9 * 3_600_000, DAY_MS = 86_400_000;
export function learningSince(period: string, now = Date.now()) {
  const days = period === "today" ? 0 : period === "30d" ? 30 : 7;
  const kstMidnight = Math.floor((now + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS;
  return new Date(kstMidnight - days * DAY_MS);
}
async function adminLearningProgress(body: any) {
  const period = ["today", "7d", "30d"].includes(body.period) ? body.period : "7d", since = learningSince(period).toISOString();
  const [students, attempts] = await Promise.all([
    allRows<any>("ready_students", "id,name,school,grade", query => query.order("school").order("grade").order("name").order("id")),
    allRows<any>("ready_workbook_attempts", "student_id,stage,correct,created_at", query => query.eq("workbook_key", SENTENCE_PRACTICE_WORKBOOK_KEY).gte("created_at", since).order("created_at", { ascending: false }).order("id")),
  ]);
  const summary = new Map<string, any>();
  for (const attempt of attempts) {
    const entry = summary.get(attempt.student_id) || { lastActivityAt: attempt.created_at, steps: { 1: { total: 0, clean: 0 }, 2: { total: 0, clean: 0 } } };
    const step = entry.steps[Number(attempt.stage)]; if (step) { step.total += 1; if (attempt.correct) step.clean += 1; }
    summary.set(attempt.student_id, entry);
  }
  return { period, since, students: students.map(student => ({ ...student, lastActivityAt: summary.get(student.id)?.lastActivityAt || null, steps: summary.get(student.id)?.steps || { 1: { total: 0, clean: 0 }, 2: { total: 0, clean: 0 } } })) };
}

// ---------- Student ----------
async function currentScope(student: Student) {
  return rows<any>(await db.from("ready_exams").select("id,school,grade").eq("school", student.school).eq("grade", student.grade).eq("is_current", true).maybeSingle());
}
async function studentPassageAccess(examId: string, passageId: string, student: Student) {
  const scope = await currentScope(student);
  if (!scope || scope.id !== examId) throw new ApiError(404, "현재 배정된 시험범위가 아닙니다.");
  const linked = rows<any>(await db.from("ready_exam_passages").select("passage_id").eq("exam_id", examId).eq("passage_id", passageId).maybeSingle());
  if (!linked) throw new ApiError(404, "현재 시험범위에 없는 문장 세트입니다.");
  return rows<any>(await db.from("ready_passages").select("id,title,source_type,source_label,updated_at,canonical_revision").eq("id", passageId).single());
}
async function activeSentences(passageIds: string[], columns = "id,passage_id,sentence_index,text,translation,block_type,active") {
  if (!passageIds.length) return [];
  return allRows<any>("ready_passage_sentences", columns, query => query.in("passage_id", passageIds).eq("active", true).order("passage_id").order("sentence_index"));
}
function itemsByPassage(passageIds: string[], sentences: any[]) {
  const grouped = new Map<string, any[]>(passageIds.map(id => [id, []]));
  for (const row of sentences) grouped.get(row.passage_id)?.push(row);
  return new Map([...grouped].map(([id, list]) => [id, practiceItems(list)]));
}
// Per-step cycle progress, maintained by the ready_workbook_attempts trigger.
// Clears of sentences that were since removed or made unorderable are not
// reported, so the client never shows more clears than sentences.
async function practiceProgress(studentId: string, examId: string, passageIds: string[], items: Map<string, { key: string }[]>) {
  const output = new Map<string, any>(), activeKeys = new Map([...items].map(([id, list]) => [id, new Set(list.map(item => item.key))]));
  for (const passageId of passageIds) output.set(passageId, Object.fromEntries(PRACTICE_STEPS.map(step => [step, { total: items.get(passageId)?.length || 0, correctClears: 0, completedCycles: 0, currentCycle: 1, currentCycleClears: [] as string[], progressPercent: 0 }])));
  if (!passageIds.length) return output;
  const [progressRows, clearRows] = await Promise.all([
    allRows<any>("ready_workbook_stage_progress", "passage_id,progress_key,correct_clears,completed_cycles,current_cycle", query => query.eq("student_id", studentId).eq("exam_id", examId).eq("workbook_key", SENTENCE_PRACTICE_WORKBOOK_KEY).eq("stage_contract_version", SENTENCE_PRACTICE_CONTRACT).in("passage_id", passageIds).order("passage_id").order("progress_key")),
    allRows<any>("ready_workbook_cycle_item_clears", "passage_id,progress_key,cycle_number,item_key", query => query.eq("student_id", studentId).eq("exam_id", examId).eq("workbook_key", SENTENCE_PRACTICE_WORKBOOK_KEY).eq("stage_contract_version", SENTENCE_PRACTICE_CONTRACT).in("passage_id", passageIds).order("passage_id").order("progress_key").order("cycle_number").order("item_key")),
  ]);
  const stepFor = (key: string) => PRACTICE_STEPS.find(step => practiceProgressKey(step) === key);
  for (const row of progressRows) {
    const step = stepFor(row.progress_key), entry = step && output.get(row.passage_id)?.[step]; if (!entry) continue;
    Object.assign(entry, { correctClears: Number(row.correct_clears) || 0, completedCycles: Number(row.completed_cycles) || 0, currentCycle: Number(row.current_cycle) || 1 });
    entry.progressPercent = workbookProgressPercent(entry.correctClears, entry.total);
  }
  for (const row of clearRows) {
    const step = stepFor(row.progress_key), entry = step && output.get(row.passage_id)?.[step];
    if (entry && Number(row.cycle_number) === entry.currentCycle && activeKeys.get(row.passage_id)?.has(row.item_key)) entry.currentCycleClears.push(row.item_key);
  }
  return output;
}
async function studentBootstrapActive(session: ReadySession) {
  const student = await studentForSession(session), scope = await currentScope(student);
  let passages: any[] = [];
  if (scope) {
    const links = await allRows<any>("ready_exam_passages", "passage_id,position", query => query.eq("exam_id", scope.id).order("position").order("passage_id")), linkedIds = links.map(link => link.passage_id);
    const passageRows = linkedIds.length ? await allRows<any>("ready_passages", "id,title,source_type,source_label,updated_at", query => query.in("id", linkedIds).order("id")) : [];
    // Only what is needed to count orderable sentences; the text is sent again per set.
    const items = itemsByPassage(linkedIds, await activeSentences(linkedIds, "id,passage_id,text,translation,block_type"));
    const progress = await practiceProgress(student.id, scope.id, linkedIds, items), byId = new Map(passageRows.map(row => [row.id, row]));
    passages = links.map(link => byId.get(link.passage_id)).filter(Boolean).map(passage => ({ ...passage, sentenceCount: items.get(passage.id)?.length || 0, progress: progress.get(passage.id) }));
  }
  return { student: { id: student.id, name: student.name, school: student.school, grade: student.grade }, scope, passages };
}
async function studentPassage(body: any, session: ReadySession) {
  const student = await studentForSession(session), examId = required(body.examId, "Exam", 80), passageId = required(body.passageId, "문장 세트", 80), passage = await studentPassageAccess(examId, passageId, student);
  const sentences = (await activeSentences([passageId])).map(({ passage_id: _passageId, ...row }) => row);
  const progress = await practiceProgress(student.id, examId, [passageId], new Map([[passageId, practiceItems(sentences)]]));
  return { passage, sentences, progress: progress.get(passageId) };
}
type PracticeContext = { passage: any; items: ReturnType<typeof practiceItems> };
async function submitSentenceAttempt(body: any, student: Student, context: (examId: string, passageId: string) => Promise<PracticeContext>) {
  const examId = required(body.examId, "Exam", 80), passageId = required(body.passageId, "문장 세트", 80), sentenceId = required(body.sentenceId, "문장", 80), step = Number(body.step);
  // Required: without it a retried request would store the attempt twice.
  const clientAttemptId = clean(body.clientAttemptId, 36);
  if (!UUID_V4.test(clientAttemptId)) throw new ApiError(400, "기록 ID를 확인해 주세요.");
  const { passage, items } = await context(examId, passageId), item = items.find(candidate => candidate.sentenceId === sentenceId);
  if (!item) throw new ApiError(404, "현재 배열할 수 없는 문장입니다.");
  const arranged = clean(body.arranged, 6000), mistakes = Number(body.mistakes), restarts = Number(body.restarts), grade = gradeSentenceAttempt({ text: item.text, step, arranged, mistakes, restarts });
  if (!grade.valid) return { rejected: true, reason: grade.reason };
  const insertResult = await db.from("ready_workbook_attempts").insert({
    student_id: student.id, exam_id: examId, passage_id: passageId, workbook_key: SENTENCE_PRACTICE_WORKBOOK_KEY, item_key: item.key, stage: step,
    stage_contract_version: SENTENCE_PRACTICE_CONTRACT, semantic_type: practiceProgressKey(step), response: { arranged, mistakes, restarts, wordCount: grade.wordCount },
    correct: grade.correct, passage_revision: Number(passage.canonical_revision) || null, client_attempt_id: clientAttemptId, stage_item_count: items.length,
  }).select("id,correct,created_at").single();
  let attempt: any;
  if (insertResult.error && insertResult.error.code === "23505") attempt = rows<any>(await db.from("ready_workbook_attempts").select("id,correct,created_at").eq("student_id", student.id).eq("client_attempt_id", clientAttemptId).single());
  else attempt = rows<any>(insertResult);
  // A concurrent duplicate returns what was stored first, not this re-grade.
  return { attempt: { id: attempt.id, correct: attempt.correct, created_at: attempt.created_at }, correct: attempt.correct === true };
}
// One batch from the client queue. Access and sentences are loaded once per
// set, progress once per set after all inserts. Per-attempt outcomes:
//   { attempt, correct, progress } stored (or replayed for a known clientAttemptId)
//   { rejected, reason }            will never be accepted; the client drops it
//   { error }                       transient; the client retries later
async function submitSentenceAttempts(body: any, session: ReadySession) {
  const attempts = Array.isArray(body.attempts) ? body.attempts.slice(0, 20) : [];
  if (!attempts.length) throw new ApiError(400, "저장할 기록이 없습니다.");
  const student = await studentForSession(session), results: any[] = [];
  // Replay attempts that were already stored (for example a timed-out request)
  // before re-checking access or re-grading: a retry must not be rejected
  // because the scope or the sentence changed after the first save.
  const clientIds = [...new Set(attempts.map((attempt: any) => clean(attempt?.clientAttemptId, 36)).filter((id: string) => UUID_V4.test(id)))];
  const stored = new Map<string, any>();
  if (clientIds.length) for (const row of rows<any[]>(await db.from("ready_workbook_attempts").select("id,correct,created_at,client_attempt_id,exam_id,passage_id,stage").eq("student_id", student.id).in("client_attempt_id", clientIds))) stored.set(String(row.client_attempt_id).toLowerCase(), row);
  const contexts = new Map<string, Promise<PracticeContext>>();
  const context = (examId: string, passageId: string) => {
    const key = `${examId}|${passageId}`;
    if (!contexts.has(key)) contexts.set(key, (async () => {
      const passage = await studentPassageAccess(examId, passageId, student);
      return { passage, items: practiceItems(await activeSentences([passageId])) };
    })());
    return contexts.get(key) as Promise<PracticeContext>;
  };
  const touched = new Map<string, { examId: string; passageId: string }>();
  for (const attempt of attempts) {
    const replay = stored.get(clean(attempt?.clientAttemptId, 36).toLowerCase());
    if (replay) { results.push({ attempt: { id: replay.id, correct: replay.correct, created_at: replay.created_at }, correct: replay.correct === true, replayed: true, examId: replay.exam_id, passageId: replay.passage_id, step: Number(replay.stage) }); continue; }
    try {
      const result: any = await submitSentenceAttempt(attempt, student, context);
      if (result.attempt) { const examId = clean(attempt.examId, 80), passageId = clean(attempt.passageId, 80); Object.assign(result, { examId, passageId, step: Number(attempt.step) }); touched.set(`${examId}|${passageId}`, { examId, passageId }); }
      results.push(result);
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) results.push({ rejected: true, reason: error.message });
      else results.push({ error: error instanceof Error ? error.message : "기록을 저장하지 못했습니다." });
    }
  }
  for (const { examId, passageId } of touched.values()) {
    const { items } = await context(examId, passageId), progress = (await practiceProgress(student.id, examId, [passageId], new Map([[passageId, items]]))).get(passageId);
    for (const result of results) if (result.attempt && result.examId === examId && result.passageId === passageId) result.progress = progress?.[result.step];
  }
  return { results: results.map(({ examId: _examId, passageId: _passageId, step: _step, ...result }) => result) };
}

async function dispatch(op: string, body: any, session: ReadySession | null, req: Request) {
  switch (op) {
    case "student_login": return studentLogin(body, req);
    case "admin_login": return adminLogin(body, req);
    case "logout": return revokeSession(session as ReadySession);
    case "student_bootstrap_active": return studentBootstrapActive(session as ReadySession);
    case "student_passage": return studentPassage(body, session as ReadySession);
    case "submit_sentence_attempts": return submitSentenceAttempts(body, session as ReadySession);
    case "teacher_bootstrap": return teacherBootstrap();
    case "create_student": return createStudent(body);
    case "set_student_code": return setStudentCode(body);
    case "delete_student": return deleteStudent(body);
    case "delete_impact": return deleteImpact(body);
    case "create_passage": return createPassage(body);
    case "passage_editor": return passageEditor(body);
    case "save_passage": return savePassage(body);
    case "delete_passage": return deletePassage(body);
    case "set_scope_passages": return setScopePassages(body);
    case "admin_learning_progress": return adminLearningProgress(body);
    default: throw new ApiError(404, UNKNOWN_OP);
  }
}
async function requestBody(req: Request) {
  try { const body = await req.json(); if (body && typeof body === "object" && !Array.isArray(body)) return body; } catch { /* reported below */ }
  throw new ApiError(400, "요청 형식이 올바르지 않습니다.");
}
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS }); if (req.method !== "POST") return json({ error: "POST만 받습니다." }, 405);
  try { const body = await requestBody(req), op = clean(body?.op, 60); let session: ReadySession | null = null; if (adminOps.has(op)) session = await authenticate(req, "admin"); else if (studentOps.has(op)) session = await authenticate(req, "student"); else if (op === "logout") session = await authenticate(req); else if (!publicOps.has(op)) throw new ApiError(404, UNKNOWN_OP); return json(await dispatch(op, body, session, req)); }
  catch (error) {
    // 5xx messages are raw database errors (table, constraint and column
    // names); they go to the function log, the client gets a generic message.
    if (!(error instanceof ApiError) || error.status >= 500) console.error(error);
    return error instanceof ApiError && error.status < 500 ? json({ error: error.message, detail: error.detail }, error.status) : json({ error: error instanceof ApiError && error.status === 503 ? error.message : "READY 서버에서 요청을 처리하지 못했습니다." }, error instanceof ApiError ? error.status : 500);
  }
});
