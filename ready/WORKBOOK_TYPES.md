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

Workbook PDF는 보존되는 원본 패키지다. 공개 판정은 파일이 아니라 exercise 단위다.

- `READY`: 원문 frame과 출판사 정답이 round-trip으로 재현되어 학생에게 공개한다.
- `UNSUPPORTED`: 원문과 provenance는 유지하지만 현재 interaction이 없어 숨긴다.
- `INVALID`: 해당 exercise의 frame/정답 연결을 증명하지 못해 숨긴다.

단계 번호는 READY의 학습 의미 계약이다. 출판사 PDF에 인쇄된 번호를 그대로 복사하지 않는다.
예를 들어 PDF의 `Workbook 9`가 문단 배열이고 `Workbook 10`이 영작이면, 의미상 영작인
`Workbook 10`을 READY 9단계로 가져온다. 문단 배열은 현재 READY 9로 변환하지 않고
`UNSUPPORTED`로 원본만 보존한다.

현재 학생 학습 범위는 2~9단계다. 2·3·5·6·8단계는 결정론적으로 채점하고, 4단계 해석은
출판사 해석을 semantic reference로 삼아 AI가 채점한다. 7단계는 출판사 정답표의
오류/교정 쌍을 명시적으로 입력받아 결정론적으로 채점한다. 9단계는 PDF의 의미상 영작
section에서 부분 문장 frame과 출판사 정답을 가져와 실제 빈칸만 결정론적으로 채점한다.
영작 section을 구조화하지 못했을 때 canonical 문장 전체를 임의의 한 칸 영작으로 만들지
않는다. 해당 exercise는 `UNSUPPORTED` 또는 `INVALID`로 비공개 유지한다. 1단계 읽기 원본과
mixed Check는 현재 학습 범위 밖으로 원본만 보존한다.

## Runtime contract

- `student_workbook`: 접근 가능한 Passage의 공개 item과 최신 진도만 반환한다.
- `submit_workbook_attempt`: 응답을 서버 정규화 후 정답표와 비교하고 append-only 시도를 남긴다.
- 현재 학습 중인 deterministic item은 즉시 피드백을 위해 정답 계약을 함께 받는다. 화면에는 제출 전 표시하지 않는다.
- 2·3단계는 현재 item의 정답을 메모리에서 사용해 첫 음절/글자가 맞는 즉시 전체 slot을 완성한다. slot별 네트워크 해제는 runtime fast path에서 사용하지 않는다.
- 9단계는 현재 문항에 한해 지연 로딩한 salted prefix verifier로 실시간 오류만 표시하고, 힌트는 요청한 slot 조각만 반환한다.
- deterministic 결과는 먼저 기기에서 표시하고 Attempt 저장과 Review/progress 동기화는 뒤에서 수행한다. 서버는 같은 규칙으로 다시 검증한다.
- 2·3단계의 미세 오타는 Attempt가 아니며, 모든 slot recall 완료 시 한 번만 append한다.
- 9단계 전체답 힌트는 제출을 막지 않지만 해당 Attempt를 오답으로 기록하고 Review에 남긴다.
- 해석 AI는 새로운 정답을 만들지 않고 비공개 출판사 해석과 의미만 비교한다.
- 틀린 제출 뒤에만 해당 빈칸의 정답을 보여 준다.
- `ready_workbook_attempts`는 원시 기록을 수정하거나 삭제하지 않는다.
- 오답은 exercise 단위로 Review에 자동 저장되고, 정답 처리되면 자동 오답 상태만 해소한다.
- 수동 북마크는 정답 여부와 무관하게 사용자가 직접 해제할 때까지 유지한다.
- Review에서 해당 exercise를 열 때도 원래 Workbook renderer를 그대로 사용한다.
- Stage 9 Attempt는 `hint_count`, `used_full_answer_hint`, `completed_after_hint`를 함께 보존한다.

일반 추출기는 `tools/ready-extract-workbook-contract.py`다. 카탈로그마다 원본 파일명과
SHA-256, 단계별 `source / ready / invalid` 수를 남긴다. 7단계도 교재별 예외 없이 같은
추출기와 answer-key-backed contract를 사용한다.
