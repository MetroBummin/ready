from pathlib import Path

factory = Path('server/ready/workbook-factory.mjs')
text = factory.read_text()
old = "const markers = [...answerText.matchAll(/워크북\\s*7\\s*어색한 곳 찾기 연습[^\\n]*/g)];"
new = "const markers = [...answerText.matchAll(/워크북\\s*7\\s*어색한 곳 찾기 연습/g)];"
if old not in text:
    raise SystemExit('Stage 7 answer marker not found')
factory.write_text(text.replace(old, new, 1))

tests = Path('tests/verify-ready-workbook-factory.mjs')
text = tests.read_text()
marker = "assert.equal(orphanAudit.exercises.filter(item=>item.type==='error_correction'&&item.sourceNumber===5).length,1,'Stage 7 must recover an answer-key continuation emitted before its repeated heading.');\n"
if marker not in text:
    raise SystemExit('Stage 7 orphan regression marker not found')
addition = r'''

// Some publisher PDF text layers keep the Stage 7 heading and the first
// answer on one physical line. The Stage 7 marker must not consume that first
// numbered correction block; the publisher answer still has to round-trip.
const sameLineFirstAnswer=`[PAGE 1]
워크북 2 빈칸 연습 (한글)
1. You have probably heard the saying, “You are what you eat.”1)
당신은 이 말을 들어 본 적이 있다.
2. It means that it is important to eat good food in order to be healthy.2)
좋은 음식을 먹는 것이 중요하다는 뜻이다.
3. But the way you eat food is just as important as eating the right food.3)
먹는 방식도 중요하다.
4. Many people have bad eating habits, but they often aren’t aware of them.4)
많은 사람들은 그것을 인지하지 못한다.
5. Do you have any bad eating habits?5)
나쁜 식습관이 있는가?
6. Let’s find out whether you fall into any of the following categories.6)
다음 범주를 알아보자.
[PAGE 2]
워크북 3 빈칸 연습 (영문)
1. 당신은 이 말을 들어 본 적이 있다.1)
You have probably heard the saying, “You are what you eat.”
2. 좋은 음식을 먹는 것이 중요하다는 뜻이다.2)
It means that it is important to eat good food in order to be healthy.
3. 먹는 방식도 중요하다.3)
But the way you eat food is just as important as eating the right food.
4. 많은 사람들은 그것을 인지하지 못한다.4)
Many people have bad eating habits, but they often aren’t aware of them.
5. 나쁜 식습관이 있는가?5)
Do you have any bad eating habits?
6. 다음 범주를 알아보자.6)
Let’s find out whether you fall into any of the following categories.
[PAGE 3]
워크북 7 어색한 곳 찾기 연습
문맥상 어색한 것 찾기
1 다음 글의 밑줄 친 부분 중 문맥상 어색한 것을 세 개 찾아 바르게 고쳐 쓰시오.1)
You have probably heard the saying, “You are what you eat.” It means that it is unimportant to eat good food in order to be healthy. But the way you eat food is just as important as eating the wrong food. Many people have bad eating habits, but they often aren’t unaware of them. Do you have any bad eating habits? Let’s find out whether you fall into any of the following categories.
(1) __________________ → __________________
(2) __________________ → __________________
(3) __________________ → __________________
[PAGE 4]
Answer Key
워크북 7 어색한 곳 찾기 연습 문맥상 어색한 것 찾기 1) (1) unimportant → important
(2) wrong → right
(3) unaware → aware
워크북 8 순서배열 연습`;
const sameLineAudit=inspectFullWorkbookText(sameLineFirstAnswer);
const sameLineItem=sameLineAudit.exercises.find(item=>item.type==='error_correction'&&item.subtype==='context'&&item.sourceNumber===1);
assert.equal(sameLineItem?.answer,'unimportant → important / wrong → right / unaware → aware','Stage 7 must preserve the first publisher Answer Key block when it shares the heading line.');
assert.deepEqual([sameLineItem?.canonicalStart,sameLineItem?.canonicalEnd],[1,6],'The recovered first Stage 7 item must round-trip to canonical sentences 1-6.');
'''
tests.write_text(text.replace(marker, marker + addition, 1))
