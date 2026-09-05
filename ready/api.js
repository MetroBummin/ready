const getConfig = () => window.READY_CONFIG || {};
const READ_ONLY_OPS = new Set([
  'teacher_bootstrap', 'delete_impact', 'student_bootstrap_active', 'student_bootstrap',
  'student_passage', 'word_lookup_meaning', 'sentence_easy_translation', 'sentence_structure', 'student_questions', 'student_question_filters', 'student_question_queue', 'student_review_questions',
  'student_review', 'student_review_export_active', 'student_workbook', 'workbook_assistance', 'workbook_hint',
  'admin_workbook_progress', 'admin_workbook_progress_detail', 'admin_workbook_attempt_replay',
]);

export async function readyApi(op, data = {}, token = '', { signal } = {}) {
  const { API_URL } = getConfig();
  if (!API_URL) throw new Error('READY config.js의 API_URL을 확인해 주세요.');
  let response;
  const attempts = READ_ONLY_OPS.has(op) ? 2 : 1;
  for (let attempt=0; attempt<attempts && !response; attempt+=1) {
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal,
        body: JSON.stringify({ op, ...data }),
      });
    } catch {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (attempt === attempts - 1) throw new Error('READY 서버에 연결할 수 없습니다. 배포 상태와 네트워크를 확인해 주세요.');
      await new Promise(resolve => setTimeout(resolve, 350));
    }
  }
  let body;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) {
    const error = new Error(body.error || `READY 서버 오류 (${response.status})`);
    error.status = response.status;
    error.detail = body.detail;
    throw error;
  }
  return body;
}
