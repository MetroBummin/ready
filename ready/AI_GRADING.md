# READY AI Grading

> Workbook grading is active. Question-specific grading is **DORMANT — preserved for future use** with the Question subsystem and is not called by the normal Student or Admin flow.

AI는 Workbook 해석과 자유도가 있는 Question 서술형에만 사용한다. 정답을 생성하지 않고
출판사 정답표의 reference와 학생 답안의 의미를 비교한다.

## Safety contract

- 학생 답안과 rubric snapshot을 AI 호출 전에 pending request로 저장한다.
- AI 성공 시 completed 결과를 저장하고 그 request를 가리키는 append-only Attempt를 추가한다.
- AI 실패 시 request를 failed로 남기며 학생 답안은 사라지지 않는다.
- 대소문자·문장부호·공백 차이는 무시할 수 있지만 필수 의미, 조건, 어형, 단어 수는 유지한다.
- AI가 reference 범위를 벗어난 새 정답을 만들 수 없다.
- Workbook `translation_ai`는 동일 문장 암기가 아니라 의미 이해를 평가하므로 exact 문자열 여부와
  관계없이 `workbook_translation_v1` 점수형 AI 채점을 사용한다.
- 일일 호출 한도를 적용한다.

Workbook에서는 `translation_ai`만 AI 채점이며 빈칸, 동사형, 어법 선택, 배열, 부분 영작은
코드가 채점한다. 특히 2단계 우리말 빈칸은 AI fallback 없이 slot별 deterministic 채점만 한다.

## Workbook translation policy

- 모델: `score`, `critical_errors`, `feedback_lines`, `error_tags`만 평가한다.
- 배점: 핵심 의미 60, 핵심 관계 30, 자연스러운 한국어 10.
- 서버: `score >= 75`이고 `critical_errors`가 없을 때만 통과시킨다.
- `rubric_snapshot`에는 원문, 출판사 해석, 모델, 정책 버전, 임계값을 저장한다.
- `result`에는 점수, 최종 판정, 중대 오류, 피드백, 오류 태그와 적용 정책을 저장한다.
- 피드백은 일반적인 칭찬/실패 문구 대신 형용사절·부사절·주절 동사·주어/목적어·부정·인과 중 실제로 이해하거나 놓친 문장 단위를 1~3줄로 지목한다.
- 성공한 attempt의 `ai_grading_request_id`로 당시 평가 결과를 다시 조회할 수 있다.

Question 서술형은 기존 `correct` 기반 semantics를 유지하며 이 점수 정책을 공유하지 않는다.
# Workbook boundary

Workbook semantic-v2 makes zero model calls during import, generation, runtime
or grading. Translation uses the publisher/canonical Korean reference and
deterministic normalization. Question and Reader AI policies are unchanged.
