# READY — app runtime

- 학생: `/ready/` (`index.html`, `app.js`)
- 관리자: `/ready/admin/` (학생, 문장 세트, 시험범위, 연습 현황)
- 서버: READY 전용 Supabase 프로젝트의 `ready` Edge Function (`server/ready/index.ts`)

```text
관리자: 학생 코드 발급 → 문장 세트(English[TAB]Korean) 등록 → 학교/학년 시험범위에 배정
학생: 6자리 코드 로그인 → 문장 세트 선택 → 1단계(소리, 틀려도 계속) → 2단계(소리 없음, 틀리면 다시)
→ 문장마다 Attempt를 기기 queue에 넣고 background batch로 저장
```

## 파일

| 파일 | 역할 |
| --- | --- |
| `sentence-practice.js` | 단계 규칙, tokenizer, 서버 재검증 (`LONG_SENTENCE_WORD_THRESHOLD = 12`) |
| `sentence-audio.js` | 1단계 소리 (Web Speech API) |
| `workbook-interaction.js` | 기존 Workbook 어순 배열에서 재사용한 칩 동작 |
| `deterministic-grading.js` | 칩 비교용 정규화 |
| `workbook-progress.js` | 단계별 cycle 진도 계산 (DB trigger와 같은 규칙) |
| `api.js`, `config.js` | API 호출과 공개 API URL |
| `admin/sentence-rows.js` | 관리자 문장 입력 파싱과 문장 ID 유지 |

## 데이터 계약

- 문장 세트는 `ready_passages`, 문장은 `ready_passage_sentences`의 활성 `SENTENCE` 행입니다. 영어 `text`와 한국어 `translation`을 함께 저장하며 서버가 번역하지 않습니다.
- 단어가 2개 미만인 문장은 배열 연습에서 빠집니다.
- 시험범위는 학교/학년별 현재 `ready_exams` 한 개와 `ready_exam_passages` 연결입니다. `ready_set_current_scope_passages`로 저장합니다.
- Attempt 저장 방식은 `../PRACTICE_NOTES.md`의 "How attempts are stored"를 따릅니다.

## 인증과 Secrets

- 학생 코드는 PostgreSQL bcrypt hash와 HMAC fingerprint만 저장합니다.
- 관리자 비밀번호는 로그인 시 한 번만 보내고 이후 opaque admin session을 사용합니다.
- API key, 관리자 비밀번호, service-role key는 frontend나 Git에 넣지 않습니다.

## 삭제

삭제 전 서버의 `delete_impact`가 연결된 기록 수를 보여 줍니다. 관리자가 확인하면 Student와 Passage cascade RPC가 하나의 transaction에서 함께 삭제합니다.
