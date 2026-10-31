# READY

고려에듀의 영어 문장 배열 연습 앱입니다. 학생은 한국어 문장을 보고 영어 문장 전체를 단어 단위로 배열합니다. 관사(a, an, the)를 포함한 모든 단어가 한 번에 칩으로 나옵니다.

- **1단계 · 듣고 배열:** 먼저 영어 문장 카드가 나옵니다(소리, 회색 막대를 누르면 한국어 뜻). 왼쪽으로 밀거나 « 밀어서 영작연습을 누르면 배열을 시작합니다. 틀린 칩은 조용히 표시되고 그대로 계속 진행합니다.
- **2단계 · 혼자 배열:** 미리보기 카드와 소리 없이 바로 배열합니다. 틀리면 그 문장을 처음부터 다시 배열합니다. 12단어 이상 문장은 한 번까지 틀려도 되고, 두 번째에 다시 시작합니다. 기준값은 `ready/sentence-practice.js`의 `LONG_SENTENCE_WORD_THRESHOLD` 하나입니다.

단계가 원래 어디에 있었는지, 무엇을 재사용했고 무엇을 지웠는지는 [`PRACTICE_NOTES.md`](./PRACTICE_NOTES.md)에 있습니다.

## 구성

- `ready/`: 학생 화면(`index.html`, `app.js`)과 최소 관리자 화면(`admin/`: 학생, 문장 세트, 시험범위, 연습 현황)
- `ready/sentence-practice.js`: 1·2단계 규칙. 학생 화면, 서버, 테스트가 같은 파일을 씁니다.
- `ready/sentence-audio.js`: 1단계 소리. 기기의 Web Speech API를 쓰며 서버나 API key가 필요 없습니다.
- `server/ready/`: READY API (`index.ts`, `auth-core.mjs`)
- `supabase/functions/ready/`: Supabase 배포 진입점
- `tools/build-pages.mjs`: 정적 사이트 빌드
- `tests/`: 단계 규칙 unit test, PGlite API 통합 test, 정적 surface test, native shell test

## UI 원칙

Student 또는 Admin UI를 바꾸기 전에 [`DESIGN.md`](./DESIGN.md)를 읽습니다. 의미 토큰은 [`design-tokens.css`](./design-tokens.css), 표현 계층은 [`ready/design.css`](./ready/design.css), 런타임 구조 규칙은 [`ready/ready.css`](./ready/ready.css)에 있습니다.

## 로컬 확인

```sh
npm test            # unit + surface + API 통합 (PGlite, 네트워크 없음)
npm run ready:test  # npm test + native shell 검사 (CI와 동일)
npm run build
npm run native:verify
npm run dev
```

로컬 주소는 `http://localhost:4173/ready/`입니다. 로컬 화면도 `ready/config.js`의 운영 API를 사용합니다.

## 배포 원칙

`main`에 푸시하면 `npm run ready:test`와 `npm run build`를 통과한 뒤 GitHub Pages를 배포합니다. API는 같은 커밋의 `server/ready/`를 Supabase Edge Function으로 배포하며 저장소의 `SUPABASE_ACCESS_TOKEN` secret이 필요합니다. 학생 화면은 배포 주소의 루트에, 관리자 화면은 `/admin/`에 놓입니다.

## 데이터베이스

테이블은 삭제하지 않았고 새 migration도 없습니다. 연습 기록은 기존 `ready_workbook_attempts`에 `workbook_key = 'sentence-practice'`로 append-only 저장되고, 기존 trigger가 단계별 진도(`ready_workbook_stage_progress`, `ready_workbook_cycle_item_clears`)를 갱신합니다.

사용 중인 테이블: `ready_students`, `ready_sessions`, `ready_login_attempts`, `ready_exams`, `ready_exam_passages`, `ready_passages`, `ready_passage_sentences`, `ready_workbook_attempts`, `ready_workbook_stage_progress`, `ready_workbook_cycle_item_clears`.

## Dormant database tables

아래 테이블은 앱이 더 이상 읽거나 쓰지 않지만 데이터와 함께 그대로 남아 있습니다.

- `ready_questions`
- `ready_attempts`
- `ready_question_bookmarks`
- `ready_ai_grading_requests`
- `ready_word_lookup_events`
- `ready_saved_words`
- `ready_saved_word_senses`
- `ready_word_states`
- `ready_word_cache`
- `ready_saved_sentences`
- `ready_sentence_translation_view_events`
- `ready_sentence_learning_cache`
- `ready_workbook_bookmarks`
- `ready_workbook_ai_grading_requests`
- `ready_workbook_catalogs`
- `ready_workbook_factory_jobs`
- `ready_content_facts`
- `ready_content_claims`
- `ready_content_claim_variants`
