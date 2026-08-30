#!/usr/bin/env python3
"""Extract the verified MCQ portion of the 18~28 Exam4You workbook.

The output is private copyrighted course content. Write it outside the repo,
review it against rendered PDF pages, then pass it to ready-import-questions.
"""

import argparse
import json
import re
from pathlib import Path

from pypdf import PdfReader

PAGE_GROUPS = {
    1: [(2, [18]), (3, [19]), (4, [20]), (5, [21]), (6, [22]), (7, [23]), (8, [24]), (9, [25]), (10, [26]), (11, [27, 28])],
    2: [(26, [18]), (27, [19]), (28, [20]), (29, [21]), (30, [22]), (31, [23]), (32, [24]), (33, [26])],
    3: [(48, [18, 19]), (49, [20, 21]), (50, [22, 23]), (51, [24, 26]), (59, [18, 19]), (60, [20, 21]), (61, [22, 23]), (62, [24, 26]), (70, [18, 19, 20]), (71, [21, 22, 23]), (72, [24, 26])],
}

QUESTION_NUMBERS = {
    1: {18: range(1, 6), 19: range(6, 11), 20: range(11, 15), 21: range(15, 19), 22: range(19, 23), 23: range(23, 27), 24: range(27, 31), 25: range(31, 33), 26: range(33, 37), 27: range(37, 39), 28: range(39, 41)},
    2: {18: range(97, 102), 19: range(102, 107), 20: range(107, 112), 21: range(112, 118), 22: range(118, 123), 23: range(123, 128), 24: range(128, 133), 26: range(133, 138)},
    3: {18: [211, 233, 255], 19: [212, 234, 256], 20: [213, 235, 257], 21: [214, 236, 258], 22: [215, 237, 259], 23: [216, 238, 260], 24: [217, 239, 261], 26: [218, 240, 262]},
}

MARKERS = "①②③④⑤⑥⑦⑧"
MARKER_INDEX = {marker: index for index, marker in enumerate(MARKERS)}

# pypdf preserves the table rows but sometimes drops the whitespace between
# adjacent cells. These rows were checked against the rendered source pages.
TABLE_CHOICES = {
    1: ["be held invited to showcase", "hold inviting showcase", "be held invited showcase", "hold invited to showcase", "be held inviting to showcase"],
    31: ["where that was", "which that was", "where those was", "which those were", "where that were"],
    39: ["melt learn bowls", "melting learn bowl", "melt to learn bowl", "melt learn bowl", "melting to learn bowls"],
    99: ["evaluate conservation showcase", "present destruction showcase", "present conservation showcase", "evaluate destruction review", "present conservation review"],
    101: ["absence exhibit", "enrollment appreciate", "participation display", "criticism revise", "competition submit"],
    111: ["incompetent neglects", "skilled prioritizes", "competent overlooks", "unqualified considers", "capable highlights"],
    117: ["rehearse perfect", "avoid incomplete", "simulate imperfect", "predict limited", "practice authentic"],
    119: ["subjective smaller pessimistic", "subjective smaller optimistic", "objective larger optimistic", "subjective larger pessimistic", "objective smaller pessimistic"],
    122: ["more consideration less likely", "little thought more significant", "low priority more certain", "more value less important", "more weight more likely"],
    125: ["substantial disappear productive", "negligible remain wasteful", "substantial disappear wasteful", "negligible remain productive", "substantial remain productive"],
    127: ["remove decline", "preserve benefit", "eliminate improvement", "multiply edge", "erase setback"],
    129: ["back further distant", "back further nearby", "back nearer distant", "forward further nearby", "forward nearer distant"],
    132: ["obstacle past", "illusion composition", "opportunity history", "challenge evolution", "chance future"],
    134: ["vague criticism preserved", "vague recognition lost", "vivid criticism preserved", "vivid recognition preserved", "vivid recognition lost"],
    137: ["disregard ignoring", "fame distorting", "criticism depicting", "wealth financing", "recognition portraying"],
}

TABLE_CHOICE_PARTS = {
    1: [["be held", "invited", "to showcase"], ["hold", "inviting", "showcase"], ["be held", "invited", "showcase"], ["hold", "invited", "to showcase"], ["be held", "inviting", "to showcase"]],
    19: [["aren’t", "are", "wins"], ["isn’t", "are", "winning"], ["aren’t", "are", "winning"], ["aren’t", "is", "winning"], ["isn’t", "is", "wins"]],
    23: [["because", "Having", "grow"], ["because of", "Having", "grow"], ["because", "Have", "growing"], ["because of", "Having", "growing"], ["because of", "Have", "grow"]],
    28: [["further", "which", "have"], ["further", "that", "has"], ["far", "which", "has"], ["further", "which", "has"], ["far", "that", "have"]],
    31: [["where", "that", "was"], ["which", "that", "was"], ["where", "those", "was"], ["which", "those", "were"], ["where", "that", "were"]],
    35: [["studied", "regarded", "lost"], ["studies", "regarding", "lost"], ["studied", "regarding", "were lost"], ["studies", "regarded", "were lost"], ["studied", "regarded", "were lost"]],
    39: [["melt", "learn", "bowls"], ["melting", "learn", "bowl"], ["melt", "to learn", "bowl"], ["melt", "learn", "bowl"], ["melting", "to learn", "bowls"]],
    99: [["evaluate", "conservation", "showcase"], ["present", "destruction", "showcase"], ["present", "conservation", "showcase"], ["evaluate", "destruction", "review"], ["present", "conservation", "review"]],
    101: [["absence", "exhibit"], ["enrollment", "appreciate"], ["participation", "display"], ["criticism", "revise"], ["competition", "submit"]],
    106: [["frustration", "regret"], ["excitement", "relief"], ["confusion", "satisfaction"], ["relief", "delight"], ["embarrassment", "anger"]],
    111: [["incompetent", "neglects"], ["skilled", "prioritizes"], ["competent", "overlooks"], ["unqualified", "considers"], ["capable", "highlights"]],
    117: [["rehearse", "perfect"], ["avoid", "incomplete"], ["simulate", "imperfect"], ["predict", "limited"], ["practice", "authentic"]],
    119: [["subjective", "smaller", "pessimistic"], ["subjective", "smaller", "optimistic"], ["objective", "larger", "optimistic"], ["subjective", "larger", "pessimistic"], ["objective", "smaller", "pessimistic"]],
    122: [["more consideration", "less likely"], ["little thought", "more significant"], ["low priority", "more certain"], ["more value", "less important"], ["more weight", "more likely"]],
    125: [["substantial", "disappear", "productive"], ["negligible", "remain", "wasteful"], ["substantial", "disappear", "wasteful"], ["negligible", "remain", "productive"], ["substantial", "remain", "productive"]],
    127: [["remove", "decline"], ["preserve", "benefit"], ["eliminate", "improvement"], ["multiply", "edge"], ["erase", "setback"]],
    129: [["back", "further", "distant"], ["back", "further", "nearby"], ["back", "nearer", "distant"], ["forward", "further", "nearby"], ["forward", "nearer", "distant"]],
    132: [["obstacle", "past"], ["illusion", "composition"], ["opportunity", "history"], ["challenge", "evolution"], ["chance", "future"]],
    134: [["vague", "criticism", "preserved"], ["vague", "recognition", "lost"], ["vivid", "criticism", "preserved"], ["vivid", "recognition", "preserved"], ["vivid", "recognition", "lost"]],
    137: [["disregard", "ignoring"], ["fame", "distorting"], ["criticism", "depicting"], ["wealth", "financing"], ["recognition", "portraying"]],
}

CITY_TOUR_TARGETS = [
    {"label": "ⓐ", "text": "control it"},
    {"label": "ⓑ", "text": "that"},
    {"label": "ⓒ", "text": "to listen"},
    {"label": "ⓓ", "text": "available"},
    {"label": "ⓔ", "text": "check out"},
]

TRADE_TARGETS = [
    {"label": "ⓐ", "text": "exists"},
    {"label": "ⓑ", "text": "to hedge"},
    {"label": "ⓒ", "text": "what"},
    {"label": "ⓓ", "text": "reinvesting"},
    {"label": "ⓔ", "text": "from which"},
]

# Exact underlined spans verified against the rendered source pages.  READY
# must never infer an underline from a bare label such as ⓐ or (A).
TARGET_RANGE_REPAIRS = {
    6: [{"label":"ⓐ","text":"what"},{"label":"ⓑ","text":"They"},{"label":"ⓒ","text":"ordering"},{"label":"ⓓ","text":"have received"},{"label":"ⓔ","text":"Knowing"}],
    11: [{"label":"ⓐ","text":"that"},{"label":"ⓑ","text":"is"},{"label":"ⓒ","text":"That"},{"label":"ⓓ","text":"the different “parts” interact with each other"},{"label":"ⓔ","text":"assembling"}],
    15: [{"label":"ⓐ","text":"which"},{"label":"ⓑ","text":"them"},{"label":"ⓒ","text":"shows"},{"label":"ⓓ","text":"were"},{"label":"ⓔ","text":"consuming"}],
    102: [{"label":"ⓐ","text":"to pick up"},{"label":"ⓑ","text":"that"},{"label":"ⓒ","text":"waited"},{"label":"ⓓ","text":"explained"},{"label":"ⓔ","text":"had chosen"},{"label":"ⓕ","text":"even better than I imagined"}],
    103: [{"label":"(A)","text":"understand"},{"label":"(B)","text":"wrong"},{"label":"(C)","text":"unrelated"},{"label":"(D)","text":"poor-quality"},{"label":"(E)","text":"better"}],
    107: [{"label":"(A)","text":"assume"},{"label":"(B)","text":"reasonable"},{"label":"(C)","text":"fails to allow for"},{"label":"(D)","text":"solution"},{"label":"(E)","text":"possess a stable center"}],
    109: [{"label":"ⓐ","text":"that"},{"label":"ⓑ","text":"what"},{"label":"ⓒ","text":"how"},{"label":"ⓓ","text":"the other"},{"label":"ⓔ","text":"composing"},{"label":"ⓕ","text":"assembled"},{"label":"ⓖ","text":"involved"}],
    112: [{"label":"(A)","text":"excel at visual imagery"},{"label":"(B)","text":"overlook forthcoming actions"},{"label":"(C)","text":"the same regions"},{"label":"(D)","text":"real thing"},{"label":"(E)","text":"reflection"},{"label":"(F)","text":"consumption of a feast"}],
    113: [{"label":"ⓐ","text":"where"},{"label":"ⓑ","text":"are"},{"label":"ⓒ","text":"what"},{"label":"ⓓ","text":"internal generated"},{"label":"ⓔ","text":"authentically"},{"label":"ⓕ","text":"yourself"}],
    114: [{"label":"㉠","text":"a wise bit of self-restraint on your genes’ part"}],
    133: [{"label":"ⓐ","text":"was known"},{"label":"ⓑ","text":"simplified"},{"label":"ⓒ","text":"bring"},{"label":"ⓓ","text":"produced"},{"label":"ⓔ","text":"including"}],
    233: [{"label":"(A)","text":"encourage more of you to take part"}],
    234: [{"label":"(A)","text":"this looks perfect, even better than I imagined"}],
    235: [{"label":"(A)","text":"lack a stable center"}],
    236: [{"label":"(A)","text":"You cannot cloy the hungry edge of appetite by bare imagination of a feast"}],
    237: [{"label":"(A)","text":"factor more into decisions than they should"}],
    238: [{"label":"(A)","text":"useless costs turn into productive costs"}],
    239: [{"label":"(A)","text":"we are looking back in time"}],
    240: [{"label":"(A)","text":"continued to explore the lives of African-Americans through his painting"}],
}

TRADE_SUMMARY = "The real barriers to trade lie in transaction costs, but a common currency can help to ㉠________ them, which in turn leads to a(n) ㉡________ in the overall economy."


def city_tour_blocks(annotated: bool):
    def target(label, text):
        return {"kind": "target", "label": label, "text": text} if annotated else {"kind": "text", "text": text}

    return [
        {"kind": "heading", "text": "Hop-on Hop-off City Tour"},
        {"kind": "paragraph", "segments": [
            {"kind": "text", "text": "Enjoy a tour you can "}, target("ⓐ", "control it" if annotated else "control"),
            {"kind": "text", "text": ". Get on or off the bus at 15 different stops. Explore "}, target("ⓑ", "that" if annotated else "what"),
            {"kind": "text", "text": " you want, when you want, for as long as you want!"},
        ]},
        {"kind": "heading", "text": "On the Bus"},
        {"kind": "bullet", "text": "Free Wi-Fi and USB ports"},
        {"kind": "bullet", "text": "Open-air top level provides wonderful city views."},
        {"kind": "bullet", "text": "Unlimited rides for one day"},
        {"kind": "heading", "text": "Audio Guides"},
        {"kind": "bullet", "segments": [{"kind": "text", "text": "Scan QR codes "}, target("ⓒ", "to listen"), {"kind": "text", "text": " to information about landmarks."}]},
        {"kind": "bullet", "segments": [{"kind": "text", "text": "Languages "}, target("ⓓ", "available"), {"kind": "text", "text": ": English, Spanish, and Chinese"}]},
        {"kind": "heading", "text": "Special Offer"},
        {"kind": "paragraph", "text": "Show your tour ticket to get a discount at museums."},
        {"kind": "note", "segments": [{"kind": "text", "text": "For prices and more information, "}, target("ⓔ", "check out"), {"kind": "text", "text": " h*h#citytour.com."}]},
    ]


def compact(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def clean_page_noise(value: str) -> str:
    value = re.sub(r"Section[❶❷❸④❹].*?학력평가", "", value)
    value = re.sub(r"-\s*\d+\s*-", "", value)
    return compact(value)


def split_passage_segments(text: str):
    matches = list(re.finditer(r"┃6월\s+(\d+)번┃", text))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        yield int(match.group(1)), text[match.end():end]


def find_question_block(segment: str, question_no: int, question_numbers) -> str:
    start_match = re.search(rf"(?<!\d){question_no}\.", segment)
    if not start_match:
        raise ValueError(f"Question {question_no}: start not found")
    later = []
    for other in question_numbers:
        if other == question_no:
            continue
        match = re.search(rf"(?<!\d){other}\.", segment[start_match.end():])
        if match:
            later.append(start_match.end() + match.start())
    end = min(later) if later else len(segment)
    return segment[start_match.end():end]


def split_choices(value: str):
    positions = [(match.start(), match.group()) for match in re.finditer(f"[{MARKERS}]", value)]
    if len(positions) < 5:
        raise ValueError("fewer than five choices")
    positions = positions[:5]
    choices = []
    for index, (start, _) in enumerate(positions):
        end = positions[index + 1][0] if index + 1 < len(positions) else len(value)
        choices.append(compact(value[start + 1:end]))
    return compact(value[:positions[0][0]]), choices


def family_for(prompt: str) -> str:
    if "주어진 문장" in prompt or "흐름상 관계없는" in prompt or "이어질 순서" in prompt:
        return "structural"
    if "요약" in prompt:
        return "summary"
    if any(word in prompt for word in ("괄호", "밑줄", "빈칸", "의미하는", "어법", "어휘")):
        return "annotated"
    return "standard"


def skill_for(prompt: str) -> str:
    for word, skill in (("어법", "grammar"), ("어휘", "vocabulary"), ("요약", "summary"), ("빈칸", "blank"), ("주어진 문장", "insertion"), ("관계없는", "irrelevant"), ("이어질 순서", "order"), ("주제", "topic"), ("제목", "title"), ("목적", "purpose"), ("심경", "emotion"), ("내용과 일치", "content"), ("의미하는", "implication")):
        if word in prompt:
            return skill
    return "comprehension"


def taxonomy_for(prompt: str, multi: bool) -> str:
    skill = skill_for(prompt)
    if skill == "grammar": return "grammar_multi_error" if multi else "grammar_single_error"
    if skill == "vocabulary": return "vocabulary_context"
    if skill == "summary": return "summary_two_blank"
    if skill == "blank": return "blank_phrase"
    if skill == "insertion": return "sentence_insertion"
    if skill == "irrelevant": return "irrelevant_sentence"
    if skill == "order": return "paragraph_order"
    if skill in ("topic", "title", "purpose", "emotion"): return skill
    if skill == "implication": return "implication"
    if "일치하지" in prompt: return "content_false"
    return "content_true"


def attach_spec(payload: dict, status: str) -> None:
    family = payload["family"]
    renderer = {"standard": "standard_mcq", "annotated": "annotated_passage_mcq", "structural": "structural", "summary": "summary"}.get(family, "standard_mcq")
    source = "canonical" if renderer in ("standard_mcq", "summary") else "blocks" if payload.get("content_blocks") else "segments" if payload.get("variant_segments") else "authored_variant" if payload.get("variant_text") else "canonical"
    payload["taxonomy"] = taxonomy_for(payload["prompt"], payload.get("multi_select") is True)
    payload["import_status"] = "ready" if status == "available" else "needs_review"
    extras = [name for name, present in (("stimulus", payload.get("stimulus")), ("summary", payload.get("summary_text"))) if present]
    payload["spec"] = {"renderer": renderer, "passage": {"source": source, "annotations": payload.get("target_ranges", [])}, "extras": extras, "choiceMode": "multi" if payload.get("multi_select") else "single", "responseMode": "choice", "gradingMode": "exact_set" if payload.get("multi_select") else "exact"}


def extract_answers(reader: PdfReader):
    text = "\n".join(reader.pages[index - 1].extract_text() or "" for index in range(111, 150))
    answers = {}
    for section in QUESTION_NUMBERS.values():
        for numbers in section.values():
            for question_no in numbers:
                match = re.search(rf"(?<!\d){question_no}\)\s*([{MARKERS}](?:\s*,?\s*[{MARKERS}])*)", text)
                if not match:
                    raise ValueError(f"Question {question_no}: answer not found")
                answers[question_no] = [MARKER_INDEX[marker] for marker in match.group(1) if marker in MARKER_INDEX]
    return answers


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("passage_map", type=Path, help='JSON object such as {"18":"uuid", ...}')
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    passage_map = {int(number): value for number, value in json.loads(args.passage_map.read_text()).items()}
    reader = PdfReader(str(args.pdf))
    answers = extract_answers(reader)
    questions = []

    for section, page_groups in PAGE_GROUPS.items():
        for page_no, expected_passages in page_groups:
            page_text = reader.pages[page_no - 1].extract_text() or ""
            segments = dict(split_passage_segments(page_text))
            for passage_no in expected_passages:
                segment = segments[passage_no]
                numbers = [number for number in QUESTION_NUMBERS[section][passage_no] if re.search(rf"(?<!\d){number}\.", segment)]
                if not numbers:
                    raise ValueError(f"Page {page_no}, Passage {passage_no}: no expected questions found")
                common_passage = ""
                if section in (1, 2):
                    after_intro = segment.split("답하시오.", 1)[-1]
                    first = re.search(rf"(?<!\d){numbers[0]}\.", after_intro)
                    common_passage = clean_page_noise(after_intro[:first.start()] if first else "")

                for position, question_no in enumerate(numbers):
                    block = find_question_block(segment, question_no, numbers)
                    answer_marker = re.search(rf"(?<!\d){question_no}\)", block)
                    if not answer_marker:
                        raise ValueError(f"Question {question_no}: choice boundary not found")
                    prompt = compact(block[:answer_marker.start()])
                    before_choices, choices = split_choices(block[answer_marker.end():])
                    choices = TABLE_CHOICES.get(question_no, choices)
                    question_passage = common_passage if section in (1, 2) else clean_page_noise(before_choices)
                    family = family_for(prompt)
                    payload = {
                        "family": family,
                        "skill": skill_for(prompt),
                        "prompt": prompt,
                        "choices": choices,
                        "answer": answers[question_no],
                        "multi_select": len(answers[question_no]) > 1,
                        "position": section * 1000 + question_no,
                        "source": {"provider": "exam4you", "exam": "2026-06 부산 고2 예상문제", "passage_no": passage_no, "source_question_no": question_no, "section": str(section)},
                    }
                    if question_no in TABLE_CHOICE_PARTS:
                        payload["choice_parts"] = TABLE_CHOICE_PARTS[question_no]
                    if section != 3 or family != "standard":
                        payload["variant_text"] = question_passage
                    if skill_for(prompt) == "insertion":
                        payload["stimulus"] = clean_page_noise(before_choices)
                    if family == "summary":
                        payload["summary_text"] = clean_page_noise(before_choices)
                    if question_no == 16:
                        payload["variant_text"] = "Humans excel at visual imagery. Our brains evolved this ability to create an internal mental picture or model of the world in which we can rehearse forthcoming actions, without the risks or the penalties of doing them in the real world. (A) There are even hints from brain-imaging studies by Harvard University psychologist Steve Kosslyn showing that your brain uses the same regions to imagine a scene as when you actually view one. (B) This is a wise bit of self-restraint on your genes’ part. (C) If your internal model of the world were a perfect substitute, then anytime you felt hungry you could simply imagine yourself at a banquet, consuming a feast. (D) You would have no incentive to find real food and would soon starve to death. (E) As the Bard said, “You cannot cloy the hungry edge of appetite by bare imagination of a feast.”"
                    if question_no == 37:
                        payload["content_blocks"] = city_tour_blocks(True)
                        payload["target_ranges"] = CITY_TOUR_TARGETS
                    if question_no in TARGET_RANGE_REPAIRS:
                        payload["target_ranges"] = TARGET_RANGE_REPAIRS[question_no]
                    if question_no == 38:
                        payload["content_blocks"] = city_tour_blocks(False)
                        payload.pop("variant_text", None)
                    if question_no == 123:
                        payload["target_ranges"] = TRADE_TARGETS
                    if question_no == 97:
                        payload["target_ranges"] = [
                            {"label": "ⓐ", "text": "Although", "canonical_text": "Although"},
                            {"label": "ⓑ", "text": "to take part", "canonical_text": "to take part"},
                            {"label": "ⓒ", "text": "is related", "canonical_text": "related"},
                            {"label": "ⓓ", "text": "interesting", "canonical_text": "interested"},
                            {"label": "ⓔ", "text": "submit", "canonical_text": "submit"},
                        ]
                    if question_no == 118:
                        payload["target_ranges"] = [
                            {"label": "ⓐ", "text": "that", "canonical_text": "that"},
                            {"label": "ⓑ", "text": "can define", "canonical_text": "can be defined"},
                            {"label": "ⓒ", "text": "the most", "canonical_text": "the more"},
                            {"label": "ⓓ", "text": "playing", "canonical_text": "play"},
                            {"label": "ⓔ", "text": "is", "canonical_text": "are"},
                        ]
                    if question_no == 128:
                        payload["target_ranges"] = [
                            {"label": "ⓐ", "text": "to reach", "canonical_text": "to reach"},
                            {"label": "ⓑ", "text": "it", "canonical_text": "it"},
                            {"label": "ⓒ", "text": "is", "canonical_text": "is"},
                            {"label": "ⓓ", "text": "familiar", "canonical_text": "familiar"},
                            {"label": "ⓔ", "text": "were", "canonical_text": "were"},
                        ]
                    if question_no == 125:
                        payload["skill"] = "vocabulary"
                    if question_no == 127:
                        payload["skill"] = "summary"
                        payload["summary_text"] = TRADE_SUMMARY
                    status = "draft" if question_no == 32 else "available"
                    attach_spec(payload, status)
                    questions.append({"passage_id": passage_map[passage_no], "type": "multiple_choice", "status": status, "payload": payload})

    questions.sort(key=lambda item: (item["payload"]["source"]["passage_no"], item["payload"]["position"], item["payload"]["source"]["source_question_no"]))
    args.output.write_text(json.dumps(questions, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"questions": len(questions), "available": sum(item["status"] == "available" for item in questions), "draft": sum(item["status"] == "draft" for item in questions)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
