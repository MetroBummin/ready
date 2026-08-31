# READY Workbook Import

## Fixed pipeline

1. 원본 PDF의 파일명과 SHA-256을 기록하고 원본을 보존한다.
2. PDF 텍스트층에서 단계별 exercise를 추출한다.
3. 출판사가 제공한 영문·우리말·정답을 source of truth로 계약을 만든다.
4. frame을 정답으로 다시 채웠을 때 출판사 원문이 재현되는지 검증한다.
5. 검증 성공 exercise만 `READY` catalog에 넣는다.
6. 현재 interaction이 없으면 `UNSUPPORTED`, 원문/정답 연결을 증명하지 못하면 `INVALID`로 기록하고 학생에게 보내지 않는다.

PDF 전체를 폐기하지 않는다. `unpublishedExercises`에는 INVALID exercise의 stage, number,
source, prompt, reason을 남긴다. 현재 학생 학습 범위는 2~9단계이며, 이 범위의 모든 단계는
공통 contract로 지원한다. 1단계 읽기 원본과 10단계 mixed Check는 현재 범위 밖이다.

## Contract rules

- renderer가 단계명, 빈칸 개수, 문자열 모양으로 interaction을 추측하지 않는다.
- `kind`, `prompt`, `answers`, `groups`, `hints`, `wordBank`가 실행 방법을 완전히 명시한다.
- 어법 선택은 모든 조합 중 출판사 전체 영문에 유일하게 존재하는 조합만 READY다.
- 7단계는 본문 전체와 출판사 정답표의 오류/교정 쌍을 계약에 넣으며, PDF의 밑줄 좌표를
  renderer가 다시 추측하지 않는다.
- 영작은 PDF의 부분 frame을 유지하고 실제 빈칸만 만든다.
- 해석은 출판사 해석을 비공개 semantic reference로 사용한다.
- 특정 교재명이나 문항 번호를 위한 repair rule은 추가하지 않는다.

일반 추출기: `tools/ready-extract-workbook-contract.py`

새 PDF에서 기존 규칙으로 충분한 READY exercise를 얻지 못하면 importer를 즉시 확장하지
말고 실패 이유를 먼저 분류한다. 여러 문서에 반복되는 일반 패턴일 때만 계약을 확장한다.
