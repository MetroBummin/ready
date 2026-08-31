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

현재 2·3·5·6·8단계는 결정론적으로 채점하고, 4단계 해석은 출판사 해석을 semantic
reference로 삼아 AI가 채점한다. 9단계는 PDF의 부분 문장 frame을 그대로 유지하고 각
실제 빈칸만 결정론적으로 채점한다. 1단계는 읽기 원본이며, 7단계와 10단계 Check에서 아직
지원하지 않는 interaction은 `UNSUPPORTED`로 보존한다.

## Runtime contract

- `student_workbook`: 접근 가능한 Passage의 공개 item과 최신 진도만 반환한다.
- `submit_workbook_attempt`: 응답을 서버 정규화 후 정답표와 비교하고 append-only 시도를 남긴다.
- 제출 전 응답에는 정답이 포함되지 않는다.
- 해석 AI는 새로운 정답을 만들지 않고 비공개 출판사 해석과 의미만 비교한다.
- 틀린 제출 뒤에만 해당 빈칸의 정답을 보여 준다.
- `ready_workbook_attempts`는 원시 기록을 수정하거나 삭제하지 않는다.
- 오답은 exercise 단위로 Review에 자동 저장되고, 정답 처리되면 자동 오답 상태만 해소한다.
- 수동 북마크는 정답 여부와 무관하게 사용자가 직접 해제할 때까지 유지한다.
- Review에서 해당 exercise를 열 때도 원래 Workbook renderer를 그대로 사용한다.

일반 추출기는 `tools/ready-extract-workbook-contract.py`다. 카탈로그마다 원본 파일명과
SHA-256, 단계별 `source / ready / invalid` 수를 남긴다. 기존 NE 1과의 손검증된 7단계는
`tools/ready-extract-ne-workbook.py`의 계약을 계속 사용한다.
