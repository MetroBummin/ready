# READY Workbook Contract

워크북은 PDF 뷰어가 아니라 학생이 직접 입력하고 서버에서 채점받는 별도 학습 흐름이다.
Question과 Workbook은 같은 Passage를 참조할 수 있지만 서로의 문제 장치와 시도 기록을
공유하지 않는다.

## PDF inventory

공통영어2 NE능률(민병천) 1과 10단계 워크북은 46쪽이다. 1~41쪽은 10개 학습 단계,
42~46쪽은 정답표다.

- 1단계: 본문 읽기/해석
- 2단계: 영문을 보고 우리말 빈칸 41문항
- 3단계: 우리말을 보고 영문 빈칸 41문항
- 4단계: 해석 직접 쓰기
- 5단계: 동사 형태
- 6단계: 어법 선택
- 7단계: 오류 고치기
- 8단계: 어순 배열
- 9단계: 영작
- 10단계: 종합

첫 구현은 동일한 빈칸 렌더러와 정확 채점으로 검증 가능한 2·3단계 82문항이다.
나머지 단계도 PDF 링크가 아니라 동일한 `item → response → attempt → progress` 계약으로
추가한다.

## Runtime contract

- `student_workbook`: 접근 가능한 Passage의 공개 item과 최신 진도만 반환한다.
- `submit_workbook_attempt`: 응답을 서버 정규화 후 정답표와 비교하고 append-only 시도를 남긴다.
- 제출 전 응답에는 정답이 포함되지 않는다.
- 틀린 제출 뒤에만 해당 빈칸의 정답을 보여 준다.
- `ready_workbook_attempts`는 원시 기록을 수정하거나 삭제하지 않는다.

원본 추출기는 `tools/ready-extract-ne-workbook.py`, 공개 런타임 카탈로그는
`server/ready/workbook-ne-l1.mjs`다. 카탈로그는 PDF 본문과 뒤쪽 정답표의 문항 수·빈칸
수를 검증한 뒤 생성한다.
