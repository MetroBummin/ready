#!/usr/bin/env python3
"""Extract the verified deterministic Lesson 1 workbook stages from the source PDF.

The PDF is the source of prompts.  The answer-key transcription below is kept
next to the extractor so a later PDF revision can be diffed and re-verified.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from pypdf import PdfReader


STAGE_ANSWERS = {
    2: """실종된 / 등산객|중요한 역할을 한 / 으로 밝혀졌습니다|자세한 내용 / 연결해|입구|구조되|숙련된 / 등산에 나섰습니다|망가뜨렸 / 길을 잘못 들|지나갈 / 경우를 대비하여|등산할|기온|신호|설상가상으로|곳|문자 메시지|길을 잃|주변 환경|지역|에 대해 보고받 / 구조|수색|협곡 / 가장자리 / 걸쳐 있|재 / 덮여 있|화질 / 위치|환경|단서|게시하 / 풍경 / 알아차릴|공유된 / 라는 이름의|추적하 / 위성 / 조사하|촬영되 / 알아내는 것|바로|에게 / 을 떠올리게 했습니다|거의 정확한 / 추론하|익숙했 / 특징 / 확인했|추측했습니다|골짜기들|을 / 와 비교했습니다|있을 법한|지목된|이례적인 / 로 / 다치지 않은|영상 통화|경로|다시""",
    3: """missing / hiker|turns out / played a key role|go over / details|entrance|rescued|experienced / went on a hike|destroyed / take a wrong turn|in case / passed by|hike|temperature|signal|To make matters worse|spot|text message|lost|surroundings|local|informed of / rescue|searching|hanging / edge / canyon|covered / ash|quality / location|conditions|clues|posted / recognized / scenery|shared / named|examining / satellite / track|determining / filmed|immediately|reminded / of|infer / approximate|familiar / checked / features|guessed|valleys|compared / with|probable|indicated|Thanks to / unusual / unharmed|video call|route|back""",
    5: """named / was found|turns / played / saving|go|am standing|heard / was recently rescued|knew / went|had destroyed / caused / to take / get|tried / shouting / wrote / passed|had planned / to hike / was coming|started / getting / was dropping|was / couldn't get|To make / was|climbed / found|used / to send|said / was / needed|sent / to show|shared|were informed / sent|searching / didn't have / was|were hanging|were covered|didn't help / was / were turned|had already spent / worried|decided / to use / to find / find|posted / asked / recognized|shared / was seen / named|is / examining / to track / informing|enjoys / determining / were taken / were filmed|saw / was / interested|saw / reminded|helped / to infer|was / had tracked / had checked|guessed / be|does not have|compared|found / provided|sent / found / indicated|was rescued|thanked|are now reminding / hike / to inform / to always bring|is""",
    6: """named / was / safe|that / played / saving|go|standing|rescued|who / went|which / to take / get|wrote|to hike|dropping|was|was|found|send|that / needed|show|shared|were informed|searching / Compean was|hanging|covered|because / turned|worried / spending|to use / find|asked|shared / was / seen / named|is / examining / track / informing|determining / pictures were / movies were|interested|reminded|to infer|because / checked|that|like|compared|provided|found / indicated|was rescued|later thanked|reminding / who / hike / inform / bring|is""",
}

STAGE8_CANONICAL = """A missing hiker named Rene Compean was found safe|It turns out that a photo played a key role in saving his life.|Let's go over to Marissa Reynolds|I'm standing here|As you just heard / Rene Compean was recently rescued|an experienced hiker / who knew the area well / went on a hike alone|a recent forest fire had destroyed some signs / which caused him to take a wrong turn and get lost|He tried shouting for help / even wrote SOS on the ground / in case a plane or helicopter passed by|He had planned to hike / night was coming|It started getting very windy / the temperature was dropping quickly|Compean was deep in the forest / his cell phone couldn't get a signal|To make matters worse, its battery was nearly dead.|He climbed up to a higher spot / found a weak signal|He used the last of his battery to send a text message to his friend.|that he was lost and needed help|He also sent a picture to show his surroundings.|Compean's friend shared the message and the picture with the local police.|When the local police were informed of the missing hiker, they immediately sent a rescue team.|Despite searching through the night, they still didn't have any idea where Compean was.|his legs were hanging|His legs were covered in black ash|the picture didn't help the police much / because the quality was poor / his location settings were turned off|As Compean had already spent one night / the police worried about his spending a second night|they decided to use social media / to find out if anyone could find clues|They posted the picture / asked if anyone recognized the scenery|The picture shared by the police / was seen by a Californian|One of his hobbies is examining satellite images / to track forest fires / informing people of potential dangers|He also enjoys determining / where pictures were taken / where movies were filmed|When he saw the picture of Compean, he was immediately interested.|When Kuo saw the black ash / it reminded him of a recent forest fire|This helped him to infer Compean's approximate location.|Kuo was very familiar with the area / because he had tracked the fire / had checked the features of the area|Kuo guessed that it must be the south side of the mountain|The north side does not have any green valleys|Kuo compared the view in Compean's picture with more satellite images|he found a match / provided the police with Compean's probable location|The police sent a rescue helicopter to the location / found Compean less than a mile / the area indicated by Kuo|Compean was rescued unharmed|He later thanked Kuo on a video call.|The local police are now reminding hikers / who hike alone / to inform others of their planned route / to always bring a paper map|This is Marissa Reynolds from LA.""".split("|")

STAGE7_ITEMS = [
    ("context", 1, 23, [("critical", "safe"), ("inexperienced", "experienced"), ("forbade", "caused")]),
    ("context", 2, 23, [("strong", "weak"), ("great", "poor"), ("turned on", "turned off")]),
    ("context", 3, 24, [("dislikes", "enjoys"), ("uninterested", "interested"), ("unfamiliar", "familiar")]),
    ("context", 4, 24, [("blamed", "thanked"), ("together", "alone")]),
    ("grammar", 1, 25, [("A missing hiker named Rene Compean was found safely on Tuesday", "A missing hiker named Rene Compean was found safe on Tuesday"), ("that caused him to take a wrong turn and get lost", "which caused him to take a wrong turn and get lost"), ("He tried shouting for help and even writing SOS on the ground", "He tried shouting for help and even wrote SOS on the ground")]),
    ("grammar", 2, 25, [("He used the last of his battery to send a text message his friend", "He used the last of his battery to send a text message to his friend"), ("he said what he was lost and needed help", "he said that he was lost and needed help"), ("his location settings were turning off", "his location settings were turned off")]),
    ("grammar", 3, 26, [("the police worried about his to spend a second night", "the police worried about his spending a second night"), ("The picture shared by the police was seen by a Californian was named Ben Kuo.", "The picture shared by the police was seen by a Californian named Ben Kuo."), ("He also enjoys to determine where pictures were taken and where movies were filmed.", "He also enjoys determining where pictures were taken and where movies were filmed.")]),
    ("grammar", 4, 26, [("away from the area indicating by Kuo", "away from the area indicated by Kuo"), ("Compean rescued unharmed.", "Compean was rescued unharmed."), ("who hikes alone to inform others of their planned route", "who hike alone to inform others of their planned route")]),
]

STAGE_META = {
    2: {"title": "2단계 · 우리말 빈칸", "instruction": "영문을 보고 우리말 해석의 빈칸을 완성하세요.", "pages": range(3, 7)},
    3: {"title": "3단계 · 영문 빈칸", "instruction": "우리말 해석을 보고 영문의 빈칸을 완성하세요.", "pages": range(7, 11)},
    5: {"title": "5단계 · 동사형", "instruction": "주어진 동사를 문장에 맞는 형태로 고쳐 쓰세요.", "pages": range(15, 19), "kind": "verb_form"},
    6: {"title": "6단계 · 어법 선택", "instruction": "각 구간에서 어법상 알맞은 표현을 고르세요.", "pages": range(19, 23), "kind": "choice_groups"},
    7: {"title": "7단계 · 어색한 곳 찾기", "instruction": "어색한 표현을 찾고 알맞게 고쳐 쓰세요.", "kind": "correction_pairs"},
    8: {"title": "8단계 · 순서 배열", "instruction": "주어진 단어와 어구를 눌러 문장 순서로 배열하세요.", "pages": range(27, 32), "kind": "reorder_groups"},
}


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def strip_page_artifacts(value: str) -> str:
    value = re.sub(r"\d\ube48\uce78\uc5f0\uc2b5.*?\uad50\uacfc\uc11c \ubcf8\ubb38", " ", value)
    value = re.sub(r"-\s*\d+\s*-", " ", value)
    return normalize(value)


def page_text(reader: PdfReader, pages: range) -> str:
    cleaned = []
    for index in pages:
        value = reader.pages[index].extract_text() or ""
        value = re.sub(r"^.*?교과서 본문\s*", "", value, count=1, flags=re.S)
        value = re.sub(r"-\s*\d+\s*-", " ", value)
        cleaned.append(value)
    return "\n".join(cleaned)


def extract_stage(reader: PdfReader, stage: int) -> list[dict]:
    text = page_text(reader, STAGE_META[stage]["pages"])
    cursor = text.find("1.")
    if cursor < 0:
        raise ValueError(f"stage {stage}: item 1 not found")
    answer_rows = [row.split(" / ") for row in STAGE_ANSWERS[stage].split("|")]
    items: list[dict] = []
    for number in range(1, 42):
        start = text.find(f"{number}.", cursor)
        marker = text.find(f"{number})", start + len(str(number)) + 1)
        if start < 0 or marker < 0:
            raise ValueError(f"stage {stage}: item {number} boundary not found")
        next_start = text.find(f"{number + 1}.", marker + len(str(number)) + 1) if number < 41 else len(text)
        if next_start < 0:
            raise ValueError(f"stage {stage}: item {number + 1} boundary not found")
        source = strip_page_artifacts(text[start + len(str(number)) + 1 : marker])
        prompt = strip_page_artifacts(text[marker + len(str(number)) + 1 : next_start])
        answers = [normalize(answer) for answer in answer_rows[number - 1]]
        if stage == 3:
            # The PDF draws one line per English word.  READY grades the answer
            # key's phrase as one meaningful slot (for example, "turns out"),
            # so collapse its consecutive word-lines into one input position.
            scan_from = 0
            for answer in answers:
                word_count = len(re.findall(r"[A-Za-z]+(?:['’][A-Za-z]+)?", answer))
                pattern = re.compile(rf"(?:_{{5,}}\s*){{{max(1, word_count)}}}")
                match = pattern.search(prompt, scan_from)
                if not match:
                    raise ValueError(f"stage {stage} item {number}: phrase slot for {answer!r} not found")
                placeholder = "⟦BLANK⟧"
                prompt = prompt[: match.start()] + placeholder + prompt[match.end() :]
                scan_from = match.start() + len(placeholder)
            prompt = prompt.replace("⟦BLANK⟧", " ______________ ")
            prompt = normalize(prompt)
        blank_count = len(re.findall(r"_{5,}", prompt))
        if blank_count != len(answers):
            raise ValueError(f"stage {stage} item {number}: {blank_count} blanks != {len(answers)} answers")
        items.append({
            "key": f"ne-mb-l1-s{stage}-{number:02d}",
            "stage": stage,
            "number": number,
            "source": source,
            "prompt": prompt,
            "answers": answers,
            "kind": "blank_input",
        })
        cursor = next_start
    return items


def numbered_rows(reader: PdfReader, pages: range) -> list[tuple[str, str]]:
    text = page_text(reader, pages)
    cursor = text.find("1.")
    rows = []
    for number in range(1, 42):
        start = text.find(f"{number}.", cursor)
        marker = text.find(f"{number})", start + len(str(number)) + 1)
        next_start = text.find(f"{number + 1}.", marker + len(str(number)) + 1) if number < 41 else len(text)
        if min(start, marker, next_start) < 0:
            raise ValueError(f"stage row {number}: boundary not found")
        rows.append((strip_page_artifacts(text[start + len(str(number)) + 1:marker]), strip_page_artifacts(text[marker + len(str(number)) + 1:next_start])))
        cursor = next_start
    return rows


def extract_stage5(reader: PdfReader) -> list[dict]:
    answers = [row.split(" / ") for row in STAGE_ANSWERS[5].split("|")]
    items = []
    for number, ((source, prompt), expected) in enumerate(zip(numbered_rows(reader, STAGE_META[5]["pages"]), answers), 1):
        hints = [normalize(value) for value in re.findall(r"\(([^()]*)\)", prompt)]
        if len(hints) != len(expected):
            raise ValueError(f"stage 5 item {number}: {len(hints)} hints != {len(expected)} answers")
        prompt = re.sub(r"\([^()]*\)", " ______________ ", prompt)
        items.append({"key": f"ne-mb-l1-s5-{number:02d}", "stage": 5, "number": number, "kind": "verb_form", "source": source, "prompt": normalize(prompt), "hints": hints, "answers": [normalize(value) for value in expected]})
    return items


def extract_stage6(reader: PdfReader) -> list[dict]:
    answers = [row.split(" / ") for row in STAGE_ANSWERS[6].split("|")]
    items = []
    rows = numbered_rows(reader, STAGE_META[6]["pages"])
    for number, ((source, prompt), expected) in enumerate(zip(rows, answers), 1):
        groups = [[normalize(option) for option in value.split(" / ")] for value in re.findall(r"\[([^\[\]]*)\]", prompt)]
        if len(groups) != len(expected) or any(answer not in group for answer, group in zip(expected, groups)):
            raise ValueError(f"stage 6 item {number}: choice groups do not match answer key")
        parts = re.split(r"\[[^\[\]]*\]", prompt)
        prompt = normalize("".join(part + (f" ⟦CHOICE:{i}⟧ " if i < len(groups) else "") for i, part in enumerate(parts)))
        items.append({"key": f"ne-mb-l1-s6-{number:02d}", "stage": 6, "number": number, "kind": "choice_groups", "source": source, "prompt": prompt, "groups": groups, "answers": [normalize(value) for value in expected]})
    return items


def phrase_position(text: str, phrase: str, occupied: list[tuple[int, int]]) -> int:
    lower, needle = text.lower(), phrase.lower()
    starts = [match.start() for match in re.finditer(re.escape(needle), lower)]
    for start in starts:
        end = start + len(needle)
        if not any(start < used_end and end > used_start for used_start, used_end in occupied):
            occupied.append((start, end))
            return start
    raise ValueError(f"cannot place reorder chip {phrase!r} in {text!r}")


def ordered_groups(groups: list[list[str]], canonical: str) -> list[str]:
    occupied: list[tuple[int, int]] = []
    positioned: list[list[tuple[int, int, str]]] = [[] for _group in groups]
    chips = [(group_index, chip_index, value) for group_index, group in enumerate(groups) for chip_index, value in enumerate(group)]
    for group_index, chip_index, value in sorted(chips, key=lambda item: len(item[2]), reverse=True):
        positioned[group_index].append((phrase_position(canonical, value, occupied), chip_index, value))
    return [" ".join(value for _position, _index, value in sorted(group)) for group in positioned]


def extract_stage8(reader: PdfReader) -> list[dict]:
    items = []
    for number, ((source, prompt), canonical) in enumerate(zip(numbered_rows(reader, STAGE_META[8]["pages"]), STAGE8_CANONICAL), 1):
        groups = [[normalize(option) for option in value.split(" / ")] for value in re.findall(r"\(([^()]*)\)", prompt)]
        answers = ordered_groups(groups, canonical)
        parts = re.split(r"\([^()]*\)", prompt)
        marked = normalize("".join(part + (f" ⟦ORDER:{i}⟧ " if i < len(groups) else "") for i, part in enumerate(parts)))
        items.append({"key": f"ne-mb-l1-s8-{number:02d}", "stage": 8, "number": number, "kind": "reorder_groups", "source": source, "prompt": marked, "groups": groups, "answers": answers})
    return items


def stage7_passage(reader: PdfReader, page_index: int, item_number: int) -> str:
    text = reader.pages[page_index].extract_text() or ""
    start = text.find(f"{item_number})")
    end = text.find("(1) _", start)
    if start < 0 or end < 0:
        raise ValueError(f"stage 7 page {page_index + 1} item {item_number}: passage boundary not found")
    return strip_page_artifacts(text[start + len(str(item_number)) + 1:end])


def extract_stage7(reader: PdfReader) -> list[dict]:
    items = []
    for index, (family, number, page_index, pairs) in enumerate(STAGE7_ITEMS, 1):
        passage = stage7_passage(reader, page_index, number)
        flat_answers = [normalize(value) for pair in pairs for value in pair]
        items.append({"key": f"ne-mb-l1-s7-{family}-{number}", "stage": 7, "number": index, "kind": "correction_pairs", "source": "", "prompt": passage, "pairCount": len(pairs), "subtype": family, "answers": flat_answers})
    return items


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    reader = PdfReader(args.pdf)
    stages = []
    extractors = {2: lambda: extract_stage(reader, 2), 3: lambda: extract_stage(reader, 3), 5: lambda: extract_stage5(reader), 6: lambda: extract_stage6(reader), 7: lambda: extract_stage7(reader), 8: lambda: extract_stage8(reader)}
    for stage, meta in STAGE_META.items():
        stages.append({
            "stage": stage,
            "title": meta["title"],
            "instruction": meta["instruction"],
            "items": extractors[stage](),
        })
    payload = {"workbookKey": "ne-minbyeongcheon-lesson-1", "title": "공통영어2 NE능률(민병천) 1과 워크북", "stages": stages}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("export const NE_MINBYEONGCHEON_L1_WORKBOOK = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    print(f"wrote {sum(len(stage['items']) for stage in stages)} items to {args.output}")


if __name__ == "__main__":
    main()
