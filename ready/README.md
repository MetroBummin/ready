# READY — Golden Path

READY는 Breeze 저장소 안에서 UI 토큰만 공유하는 고려에듀 내부용 웹앱입니다.

- 학생: `/ready/`
- 관리자: `/ready/admin/`
- 서버: READY 전용 Supabase 프로젝트의 `ready` Edge Function

이번 시험 기간 READY의 운영 경계는 분명합니다.

```text
원본 자료 → ChatGPT Work에서 정리·분석 → 구조화된 Passage / Question 데이터
→ 검증된 원자적 저장 계약으로 READY에 반영
→ Passage 여러 개 선택 → 학교/학년 시험범위에 배정
→ 학생 PIN 로그인 → 문제 풀이 → Attempt → 오답 복습
```

READY 안에는 PDF/DOCX/Excel/TSV Import UI, 파일 parser, AI 추출 workflow를 두지 않습니다.
Work가 private structured Question bundle을 준비하고 READY는 검증·원자적 저장·풀이·채점·오답
Review를 책임집니다.

## Question 작업 필수 절차

**Any READY question-related task must read `ready/QUESTION_TYPES.md` and `ready/QUESTION_IMPORT.md` first.**

다음 작업은 두 문서를 source of truth로 삼습니다.

- PDF 문제 import
- 새로운 question type 추가
- question renderer 수정·추가
- variant passage 처리
- grading contract 변경
- question source metadata 처리

기존 renderer 재사용을 먼저 검토하고, Question에 맞추기 위해 canonical Passage를 수정하지
않습니다. 새 패턴이나 contract 변경은 구현과 같은 commit에서 두 문서에 기록합니다.

## Workbook 작업 필수 절차

**Any READY workbook-related task must read `ready/WORKBOOK_TYPES.md` first.**

워크북은 PDF 링크가 아니라 학생이 입력하고 즉시 채점받으며 진행률이 저장되는 별도 학습
runtime입니다. PDF는 원본과 정답의 근거로만 사용합니다. 현재 첫 구현 범위는 NE능률(민병천)
공통영어2 1과의 2·3단계 82문항이며, 한 문항씩 독립적으로 저장·채점합니다.

## 데이터 계약

- 구조화된 `sentenceRows` 항목 하나는 `PassageSentence` 한 개입니다.
- 각 항목은 영어 `text`와 한국어 `translation`을 가지며 서버가 다시 분리하거나 번역하지 않습니다.
- Passage와 모든 문장/해석은 `ready_create_passage_with_sentences` 한 transaction으로 저장합니다.
- Reader와 Question passage는 연속된 plain prose입니다. `READER_INLINE_GLOSS_ENABLED` 실험이
  켜진 경우에만 Reader의 영어 단어를 문맥상 짧은 한국어 뜻으로 직접 치환할 수 있습니다.
  Question/Workbook에는 lookup 이벤트가 연결되지 않으며 문장 해석, SavedWord/SavedSentence,
  lexical highlight UI는 계속 비활성입니다. 기존 운영 데이터와 관련 테이블은 삭제하지 않습니다.
- 학교/학년별 현재 시험범위와 Passage 연결은 `ready_set_current_scope_passages` 한 transaction으로 저장합니다.
- Passage 소속의 Source of Truth는 `ready_exam_passages`입니다.
- `ready_exams`는 기록 분리를 위한 내부 구현이며 학생과 관리자에게 생성·선택 개념을 노출하지 않습니다.
- Question은 `multiple_choice`와 `written_response` 두 deterministic response contract를 사용합니다.
  Standard/Annotated/Structural/Summary/Written family는 같은 Question/Attempt lifecycle을 공유합니다.
- `ready_attempts`는 append-only이며 학생별 마지막 Attempt가 오답인 Question이 자동으로 Review에
  나타납니다. 복습 정답 Attempt가 추가되면 해결됩니다.
- StudySet/Publication은 신규 runtime과 clean migration에서 사용하지 않습니다.

## 로컬 확인

```bash
npm run ready:dev
```

그다음 `http://127.0.0.1:4173/ready/admin/`을 엽니다. 로컬 frontend도
`ready/config.js`에 설정된 READY Supabase backend를 사용하므로 Pages 배포 전에 바로 검증할 수 있습니다.

핵심 정적/계약 테스트:

```bash
npm run ready:test
```

## 인증과 Secrets

- 학생 PIN은 PostgreSQL bcrypt hash만 저장합니다.
- 관리자 비밀번호는 로그인 시 한 번만 보내고 이후 opaque admin session을 사용합니다.
- API key, 관리자 비밀번호, service-role key는 frontend나 Git에 넣지 않습니다.
- 기존 lexical 데이터와 비활성 서버 함수는 보존합니다. Reader inline gloss만 별도 학생 operation으로
  연결하며 SavedWord/문장 번역 operation은 연결하지 않습니다.
- Question import용 관리자 비밀번호와 서버 key는 client·git·로그에 넣지 않습니다.

## 배포

`supabase/migrations/`의 migration을 순서대로 적용한 뒤 `ready` Edge Function을 배포합니다.
새 READY DB는 migration 디렉터리만으로 현재 schema를 만들 수 있어야 하며 `sql/ready_*.sql`
수동 실행에 의존하지 않습니다.

```bash
npx supabase db push --linked
npx supabase functions deploy ready --no-verify-jwt
```

삭제 전 서버의 `delete_impact`가 연결 수를 계산합니다. 관리자가 확인하면 Student와 Passage
cascade RPC가 Attempt와 학습 이벤트까지 하나의 transaction에서 함께 삭제합니다. 학교/학년
시험범위는 영구 슬롯이므로 삭제하지 않고 포함 Passage만 교체합니다.
