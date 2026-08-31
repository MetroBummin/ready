# READY AI Grading

AI는 Workbook 해석과 자유도가 있는 Question 서술형에만 사용한다. 정답을 생성하지 않고
출판사 정답표의 reference와 학생 답안의 의미를 비교한다.

## Safety contract

- 학생 답안과 rubric snapshot을 AI 호출 전에 pending request로 저장한다.
- AI 성공 시 completed 결과를 저장하고 append-only Attempt를 추가한다.
- AI 실패 시 request를 failed로 남기며 학생 답안은 사라지지 않는다.
- 대소문자·문장부호·공백 차이는 무시할 수 있지만 필수 의미, 조건, 어형, 단어 수는 유지한다.
- AI가 reference 범위를 벗어난 새 정답을 만들 수 없다.
- deterministic exact match가 먼저 통과하면 AI를 호출하지 않는다.
- 일일 호출 한도를 적용한다.

Workbook에서는 `translation_ai`만 AI 채점이며 빈칸, 동사형, 어법 선택, 배열, 부분 영작은
코드가 채점한다.
