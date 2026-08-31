#!/usr/bin/env python3
"""Extract NE Min Byeongcheon Common English 2 lessons 1-2.

The eight workbooks and their answers remain private course content. This tool
writes a local manifest only; it never commits the extracted questions. The
canonical reading identity is one whole lesson. Every Question remains an
independent scheduling/grading unit; `source.set_id` is provenance only and
must never make adjacent questions one UI bundle.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import re
import unicodedata
from pathlib import Path

import pdfplumber
from pypdf import PdfReader


MARKERS = "①②③④⑤⑥⑦⑧"
MARKER_INDEX = {marker: index for index, marker in enumerate(MARKERS)}
WRITTEN = [
    {3, 10, 14}, {6, 7, 10, 13, 16}, {5, 13, 19}, {5, 11, 13, 20},
    {11, 13, 20}, {4, 8, 12, 20}, {3, 8, 12, 15}, {3, 4, 11},
]

def compact(value: str) -> str:
    # Keep pedagogical identity marks such as ⓐ, ㉠ and ①. Compatibility
    # normalization silently turns them into plain letters/numbers.
    value = unicodedata.normalize("NFC", value or "")
    value = value.replace("‘", "'").replace("’", "’")
    value = re.sub(r"(?<![A-Za-z])((?:[A-Za-z]\s+){3,}[A-Za-z])(?=[^A-Za-z]|$)", lambda m: m.group(1).replace(" ", ""), value)
    value = re.sub(r"\s+([,.;:!?])", r"\1", value)
    return re.sub(r"\s+", " ", value).strip()


def clean_noise(value: str) -> str:
    value = re.sub(r"===== PAGE \d+ =====", " ", value)
    value = re.sub(r"예상문제\s*\d+회", " ", value)
    value = re.sub(r"NE능률\s*\(\s*민병천\s*\)\s*[12]\s*과", " ", value)
    value = re.sub(r"공통영어2|고등\s*2022\s*개정|-\s*\d+\s*-", " ", value)
    value = re.sub(r"(?:^|\s)-(?=\s|$)", " ", value)
    value = re.sub(r"(?:\s*)?다음\s*(?:글|대화)(?:을|를)\s*읽고\s*(?:다음\s*)?물음에\s*답하시오\s*[.!?]?", " ", value)
    return compact(value)


def problem_pages(path: Path) -> tuple[str, list[dict]]:
    """Read visual blocks without discarding their PDF coordinates."""
    chunks, spans, cursor = [], [], 0
    with pdfplumber.open(path) as pdf:
        for page_index, page in enumerate(pdf.pages, 1):
            full = page.extract_text() or ""
            if "공통영어2 정답" in full:
                break
            middle, margin = page.width / 2, 42
            boxes = ((margin, 65, middle - 4, page.height - 28), (middle + 4, 65, page.width - margin, page.height - 28))
            for box in boxes:
                chunk = page.crop(box).extract_text(x_tolerance=1.5, y_tolerance=3, layout=True) or ""
                if chunks:
                    cursor += 1
                start = cursor
                chunks.append(chunk)
                cursor += len(chunk)
                spans.append({"start": start, "end": cursor, "page": page_index, "bbox": [round(float(value), 2) for value in box]})
    return "\n".join(chunks), spans


def source_location(spans: list[dict], start: int, end: int) -> dict:
    candidates = [(max(0, min(end, span["end"]) - max(start, span["start"])), span) for span in spans]
    overlap, span = max(candidates, key=lambda item: item[0])
    if overlap <= 0:
        return {"page": None, "bbox": None}
    return {"page": span["page"], "bbox": span["bbox"]}


def source_paths(downloads: Path) -> list[Path]:
    names = [
        f"(2022개정)2025년_공통영어2_NE능률(민병천)_{lesson}과_예상문제 {round_}회.pdf"
        for lesson in (1, 2) for round_ in (1, 2, 3, 4)
    ]
    return [downloads / name for name in names]


def textbook_lessons(path: Path) -> list[dict]:
    lessons = {1: [], 2: []}
    with pdfplumber.open(path) as pdf:
        for page_index, page in enumerate(pdf.pages):
            lesson = 1 if page_index < 2 else 2
            tables = page.extract_tables()
            if len(tables) != 1:
                raise ValueError(f"textbook page {page_index + 1}: expected one table")
            for row in tables[0]:
                if len(row) < 2 or not row[0] or not row[1]:
                    continue
                english = compact(re.sub(r"^\s*\d+\s+", "", row[0]))
                korean = compact(row[1])
                if lesson == 2 and english == "A Creative Idea Sparks a Whole New Field":
                    continue
                lessons[lesson].append({"text": english, "translation": korean})
    if len(lessons[1]) != 43 or len(lessons[2]) != 51:
        raise ValueError(f"textbook row contract failed: {[len(lessons[1]), len(lessons[2])]}")
    return [
        {"key": "ne-minbyeongcheon-l1", "title": "공통영어2 NE능률(민병천) 1과", "source_label": "공통영어2 NE능률(민병천) 1과", "rows": lessons[1]},
        {"key": "ne-minbyeongcheon-l2", "title": "공통영어2 NE능률(민병천) 2과 · A Creative Idea Sparks a Whole New Field", "source_label": "공통영어2 NE능률(민병천) 2과", "rows": lessons[2]},
    ]


def answer_table(reader: PdfReader) -> dict[int, list[int] | None]:
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    answer_area = text.split("공통영어2 정답", 1)[-1]
    answers: dict[int, list[int] | None] = {}
    for match in re.finditer(r"(?<!\d)(\d{1,2})\.\s*(주관식|[①②③④⑤](?:\s*,\s*[①②③④⑤])*)", answer_area):
        number = int(match.group(1))
        if number not in range(1, 21) or number in answers:
            continue
        raw = match.group(2)
        answers[number] = None if raw == "주관식" else [MARKER_INDEX[m] for m in raw if m in MARKER_INDEX]
    if set(answers) != set(range(1, 21)):
        raise ValueError(f"answer table missing: {sorted(set(range(1,21)) - set(answers))}")
    return answers


def answer_variants(value: str) -> list[str]:
    """Expand publisher alternatives such as who[that] without guessing."""
    value = re.sub(r"(?<![A-Za-z])(?:[A-Za-z] ){1,}[A-Za-z](?![A-Za-z])", lambda match: match.group(0).replace(" ", ""), value)
    value = compact(value).replace("Com pean", "Compean")
    for broken, repaired in {
        "th at": "that", "tobe": "to be", "n owonder": "no wonder",
        "c alled": "called", "ca lle d": "called", "sh e": "she", "m otherof": "mother of", "mo th erof": "mother of",
        "fo re n sic": "forensic", "i n": "in", "t o": "to", "o f": "of", "s o": "so",
    }.items():
        value = re.sub(rf"\b{re.escape(broken)}\b", repaired, value, flags=re.I)
    value = re.sub(r"\bcalled\s*,\s*mother\b", "called mother", value, flags=re.I)
    variants = [value]
    while any(re.search(r"(?:\b([A-Za-z]+))?\[([^\]]+)\]", item) for item in variants):
        expanded = []
        for item in variants:
            match = re.search(r"(?:\b([A-Za-z]+)\s*)?\[([^\]]+)\]", item)
            if not match:
                expanded.append(item)
                continue
            base, alternative = match.group(1) or "", match.group(2)
            before, after = item[:match.start()], item[match.end():]
            expanded.extend([before + base + after, before + alternative + after])
        variants = expanded
    return list(dict.fromkeys(compact(item) for item in variants if compact(item)))


def written_answer_table(reader: PdfReader, expected: set[int]) -> dict[int, list]:
    """Read fixed written answers from the publisher answer table."""
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    marker = re.search(r"주관식\(서답형\)", text)
    if not marker:
        raise ValueError("written answer section not found")
    area = text[marker.end():]
    positions = []
    cursor = 0
    for number in sorted(expected):
        match = re.search(rf"(?m)^\s*{number}\.\s+", area[cursor:])
        if not match:
            raise ValueError(f"written answer {number}: heading not found")
        start, content_start = cursor + match.start(), cursor + match.end()
        positions.append((number, start, content_start))
        cursor = content_start
    answers = {}
    for index, (number, _start, content_start) in enumerate(positions):
        end = positions[index + 1][1] if index + 1 < len(positions) else len(area)
        block = re.split(r"(?m)^\s*-\s*\d+\s*-\s*$", area[content_start:end], maxsplit=1)[0]
        block = re.sub(r"(?<![A-Za-z])(?:[A-Za-z] ){1,}[A-Za-z](?![A-Za-z])", lambda match: match.group(0).replace(" ", ""), block)
        block = compact(block)
        block = re.sub(r"\(\s*([1-9A-C])\s*\)", r"(\1)", block)
        numbered = list(re.finditer(r"\((\d+)\)\s*(.*?)(?=\(\d+\)|$)", block))
        labelled = list(re.finditer(r"\(([A-C])\)\s*(.*?)(?=\([A-C]\)|$)", block))
        raw_slots = []
        if numbered:
            for item in numbered:
                value = compact(item.group(2))
                correction = re.match(r"([ⓐ-ⓕ])\s*.+?\s*(?:→|->)\s*(.+)$", value)
                raw_slots.append(f"{correction.group(1)} {correction.group(2)}" if correction else value)
        elif labelled:
            raw_slots = [compact(item.group(2)) for item in labelled]
        elif block.count(",") >= 2 and all(len(part.split()) <= 5 for part in block.split(",")):
            raw_slots = [compact(part) for part in block.split(",")]
        else:
            raw_slots = [block]
        answers[number] = []
        for slot in raw_slots:
            variants = answer_variants(slot)
            answers[number].append(variants[0] if len(variants) == 1 else variants)
    if set(answers) != expected:
        raise ValueError(f"written answer table mismatch: {sorted(set(answers) ^ expected)}")
    return answers


def explanation_table(reader: PdfReader) -> dict[int, str]:
    """Extract the fixed, publisher-authored explanation for each question.

    The answer pages sometimes OCR ``10)`` as ``1 0 )``.  We therefore parse
    the heading as two optional digit groups, then enforce the 1..20 sequence
    so years and numbered examples can never become question boundaries.
    """
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    if "정답 및 해설" not in text:
        raise ValueError("explanation section not found")
    area = text.rsplit("정답 및 해설", 1)[-1]
    candidates = []
    for match in re.finditer(r"(?m)^\s*(\d)\s*(\d?)\s*\)\s+", area):
        number = int(match.group(1) + match.group(2))
        if 1 <= number <= 20:
            candidates.append((number, match.start(), match.end()))
    positions = []
    cursor = 0
    for expected in range(1, 21):
        found = next((item for item in candidates if item[1] >= cursor and item[0] == expected), None)
        if not found:
            raise ValueError(f"explanation {expected}: heading not found")
        positions.append(found)
        cursor = found[2]
    explanations = {}
    for index, (number, _start, content_start) in enumerate(positions):
        end = positions[index + 1][1] if index < 19 else len(area)
        chunk = area[content_start:end]
        # The final explanation is followed by a separate written-answer key.
        chunk = re.split(r"(?m)^\s*공통영어2.*?-\s*주관식", chunk, maxsplit=1)[0]
        explanation = clean_noise(chunk)
        if len(explanation) < 8:
            raise ValueError(f"explanation {number}: empty or too short")
        explanations[number] = explanation
    return explanations


def question_positions(problem_text: str) -> list[tuple[int, int, int]]:
    # Some generated PDFs concatenate the next heading directly after choice ⑤
    # ("...setting15. 윗글..."). The Korean/Who look-ahead rejects dates such
    # as "April 12. However" while allowing that broken layout.
    candidates = list(re.finditer(r"(?<!\d)(\d{1,2})\.\s+(?=[가-힣W다])", problem_text))
    result = []
    cursor = 0
    for expected in range(1, 21):
        found = next((m for m in candidates if m.start() >= cursor and int(m.group(1)) == expected), None)
        if not found:
            raise ValueError(f"question {expected}: heading not found")
        result.append((expected, found.start(), found.end()))
        cursor = found.end()
    return result


def split_choices(value: str) -> tuple[str, list[str], list[str]]:
    markers = list(re.finditer(f"[{MARKERS}]", value))
    if len(markers) < 5:
        return compact(value), [], []
    markers = markers[:5]
    prefix = compact(value[:markers[0].start()])
    raw_choices = []
    for index, marker in enumerate(markers):
        end = markers[index + 1].start() if index < 4 else len(value)
        raw_choices.append(value[marker.end():end])
    trailing = ""
    directive = raw_choices[-1].rfind("")
    if directive >= 0:
        trailing = raw_choices[-1][directive:]
        raw_choices[-1] = raw_choices[-1][:directive]
    return prefix, [clean_noise(choice) for choice in raw_choices], clean_noise(trailing)


def prompt_and_body(number: int, value: str) -> tuple[str, str]:
    boundary = re.search(rf"(?<!\d){number}\)", value[:1400])
    if not boundary:
        raise ValueError(f"question {number}: source footnote boundary not found")
    return compact(value[:boundary.start()]), value[boundary.end():]


def family_for(prompt: str, written: bool) -> str:
    if written:
        return "written"
    if "요약" in prompt:
        return "summary"
    if any(word in prompt for word in ("주어진 문장", "관계없는 문장", "이어질 순서")):
        return "structural"
    if any(word in prompt for word in ("괄호", "밑줄", "빈칸", "어법", "영영풀이", "가리키는")):
        return "annotated"
    return "standard"


def skill_for(prompt: str, written: bool) -> str:
    if written:
        return "writing"
    rules = (("어법", "grammar"), ("영영풀이", "vocabulary"), ("흐름상 어색", "irrelevant"), ("관계없는 문장", "irrelevant"), ("요약", "summary"), ("빈칸", "blank"), ("주어진 문장", "insertion"), ("이어질 순서", "order"), ("주제", "topic"), ("제목", "title"), ("내용과 일치", "content"), ("답할 수 없는", "content"), ("가리키는", "comprehension"))
    return next((skill for token, skill in rules if token in prompt), "comprehension")


def taxonomy_for(prompt: str, written: bool, multi: bool = False) -> str:
    skill = skill_for(prompt, written)
    if written:
        if "배열" in prompt: return "arrangement"
        if "고쳐" in prompt: return "correction"
        if "해석" in prompt: return "translation"
        if "요약" in prompt: return "summary_completion"
        return "guided_writing"
    if skill == "grammar": return "grammar_multi_error" if multi else "grammar_single_error"
    if skill == "vocabulary": return "vocabulary_context"
    if skill == "summary": return "summary_two_blank"
    if skill == "blank": return "blank_phrase"
    if skill == "insertion": return "sentence_insertion"
    if skill == "irrelevant": return "irrelevant_sentence"
    if skill == "order": return "paragraph_order"
    if skill in ("topic", "title"): return skill
    if "답할 수 없는" in prompt: return "unanswerable"
    if "일치하지" in prompt: return "content_false"
    return "content_true"


def attach_spec(payload: dict, question_type: str) -> None:
    written = question_type == "written_response"
    family = payload["family"]
    renderer = "written_input" if written else {"standard": "standard_mcq", "annotated": "annotated_passage_mcq", "structural": "structural", "summary": "summary"}.get(family, "standard_mcq")
    source = "canonical" if renderer in ("standard_mcq", "summary") else "blocks" if payload.get("content_blocks") else "segments" if payload.get("variant_segments") else "authored_variant" if payload.get("set_text") or payload.get("variant_text") else "canonical"
    multi = payload.get("multi_select") is True
    payload["taxonomy"] = taxonomy_for(payload["prompt"], written, multi)
    payload["import_status"] = "ready"
    extras = [name for name, present in (("stimulus", payload.get("stimulus")), ("summary", payload.get("summary_text"))) if present]
    payload["spec"] = {"renderer": renderer, "passage": {"source": source, "annotations": payload.get("target_ranges", [])}, "extras": extras, "choiceMode": "none" if written else "multi" if multi else "single", "responseMode": "input" if written else "choice", "gradingMode": "accepted_variants" if written else "exact_set" if multi else "exact"}


def inline_groups(text: str) -> list[dict]:
    return [{"label": match.group(1), "options": [compact(value) for value in match.group(2).split("/")]} for match in re.finditer(r"(ⓐ|ⓑ|ⓒ|ⓓ|ⓔ|ⓕ|\([A-H]\))\s*\[([^\]]+)\]", text)]


def choice_parts(text: str, choices: list[str]) -> list[list[str]]:
    groups = inline_groups(text)
    if len(groups) < 2:
        return []
    combinations = [(list(parts), compact(" ".join(parts))) for parts in itertools.product(*(group["options"] for group in groups))]
    result = []
    for choice in choices:
        normalized = re.sub(r"[^a-z0-9]+", "", choice.lower())
        match = next((parts for parts, joined in combinations if re.sub(r"[^a-z0-9]+", "", joined.lower()) == normalized), None)
        if not match:
            return []
        result.append(match)
    return result


def target_ranges(text: str, prompt: str) -> list[dict]:
    labels = sorted(set(re.findall(r"[ⓐ-ⓕ]", text))) if re.search(r"[ⓐ-ⓕ]\s*[~～-]\s*[ⓐ-ⓕ]", prompt) else sorted(set(re.findall(r"[ⓐ-ⓕ]", prompt)))
    ranges = []
    for label in labels:
        match = re.search(re.escape(label) + r"\s*([A-Za-z][A-Za-z’'\-]*(?:\s+[A-Za-z][A-Za-z’'\-]*){0,3})", text)
        if not match:
            continue
        words = match.group(1).split()
        if words[0].lower() == "to" and len(words) >= 2:
            words = words[:2]
        elif words[0].lower() in {"has", "have", "had", "is", "are", "was", "were", "being", "been"}:
            words = words[: min(3, len(words))]
        elif len(words) >= 2 and words[1].lower() in {"off", "on", "up", "out", "in", "away", "back", "over", "down", "through", "around", "along"}:
            words = words[:2]
        else:
            words = words[:1]
        ranges.append({"label": label, "text": " ".join(words)})
    return ranges


def response_slots(accepted_answers: list) -> list[dict]:
    count = len(accepted_answers)
    slots = []
    for index, accepted in enumerate(accepted_answers):
        variants = accepted if isinstance(accepted, list) else [accepted]
        word_counts = {len(re.findall(r"[A-Za-z0-9]+(?:['’][A-Za-z]+)?", str(value))) for value in variants}
        slots.append({"label": "답" if count == 1 else f"답 {index + 1}", "word_count": next(iter(word_counts)) if len(word_counts) == 1 else None})
    return slots


def writing_guide(prompt: str, body: str, slots: list[dict]) -> dict:
    condition_area = body.split("<조건>", 1)[-1] if "<조건>" in body else body
    conditions = [compact(line.lstrip("•●- ")) for line in condition_area.splitlines() if line.strip().startswith(("•", "●"))]
    bank = []
    view = re.search(r"<보기>\s*(.+?)(?=→|$)", condition_area, re.S)
    if view:
        for item in re.split(r"[,/]", view.group(1)):
            item = compact(item)
            if re.search(r"[A-Za-z]", item) and not re.search(r"[가-힣]", item):
                bank.append(item)
    kind = "multi-correction" if "고쳐" in prompt and len(slots) > 1 else "sentence"
    korean = re.findall(r"[가-힣][가-힣A-Za-z0-9\s,.'’“”()·-]{8,}?(?:다|요)\.", body)
    task_text = max(korean, key=len).strip() if korean else ""
    targets = target_ranges(body, prompt) if "고쳐" in prompt else []
    return {"kind": kind, "title": prompt, "slot_labels": [slot["label"] for slot in slots], "conditions": conditions, "word_bank": bank, "task_text": task_text, "targets": targets}


def english_tokens(value: str) -> list[str]:
    return re.findall(r"[a-z]+(?:['’][a-z]+)?", value.lower())


def source_kind(set_text: str, textbook_text: str) -> str:
    if len(re.findall(r"(?:^|\s)[A-Z]{1,3}:\s", set_text)) >= 3:
        return "dialogue"
    source, candidate = english_tokens(textbook_text), english_tokens(set_text)
    if len(source) < 12 or len(candidate) < 12:
        return "supplemental"
    source_bigrams = set(zip(source, source[1:]))
    candidate_bigrams = list(zip(candidate, candidate[1:]))
    coverage = sum(pair in source_bigrams for pair in candidate_bigrams) / max(1, len(candidate_bigrams))
    return "textbook_main" if coverage >= .34 else "supplemental"


def extract_exam(path: Path, exam_index: int, written_answers: dict[str, list] | None = None) -> list[dict]:
    lesson = 1 if exam_index <= 4 else 2
    round_ = (exam_index - 1) % 4 + 1
    reader = PdfReader(str(path))
    answers = answer_table(reader)
    embedded_written_answers = written_answer_table(reader, WRITTEN[exam_index - 1])
    explanations = explanation_table(reader)
    problem_text, source_spans = problem_pages(path)
    document_sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    positions = question_positions(problem_text)
    current_context = clean_noise(problem_text[:positions[0][1]].split("")[-1])
    questions = []
    for order, (number, start, content_start) in enumerate(positions):
        end = positions[order + 1][1] if order < 19 else len(problem_text)
        location = source_location(source_spans, start, end)
        prompt, body = prompt_and_body(number, problem_text[content_start:end])
        inline_context, choices, trailing_context = split_choices(body)
        written = number in WRITTEN[exam_index - 1]
        if written:
            source_before_conditions = clean_noise(body.split("<조건>", 1)[0])
            if prompt.startswith("다음 글") and len(source_before_conditions) > 40:
                set_text = source_before_conditions
                current_context = source_before_conditions
            else:
                set_text = current_context
        else:
            # A long answer stem is not necessarily a new passage. In several
            # worksheets, Korean student comments appear before the five
            # choices; treating those comments as `current_context` poisoned
            # every following question in the set. Only an English passage can
            # replace the shared passage context.
            if (
                inline_context
                and len(english_tokens(inline_context)) >= 12
                and re.match(r"^(?:[A-Za-z“‘'\"]|\[[A-Za-z])", inline_context)
            ):
                current_context = inline_context
            set_text = current_context
        if trailing_context:
            next_context = trailing_context.split("", 1)[-1]
        else:
            next_context = ""
        if written != (answers[number] is None):
            raise ValueError(f"exam {exam_index} q{number}: written/answer-table mismatch")
        context_hash = hashlib.sha1(set_text.encode("utf-8")).hexdigest()[:12]
        source = {
            "provider": "exam4you",
            "exam": f"공통영어2 NE능률(민병천) {lesson}과 예상문제 {round_}회",
            "passage_no": lesson,
            "source_question_no": number,
            "section": str(round_),
            "set_id": f"ne-l{lesson}-r{round_}-{context_hash}",
            "document_sha256": document_sha256,
            "source_file": path.name,
            "page": location["page"],
            "bbox": location["bbox"],
        }
        payload = {
            "family": family_for(prompt, written),
            "skill": skill_for(prompt, written),
            "prompt": prompt,
            "position": (lesson - 1) * 1000 + round_ * 100 + number,
            "set_text": set_text,
            "source": source,
            "explanation": explanations[number],
        }
        if written:
            # Preserve the complete private PDF evidence. A written question
            # often keeps its marked Passage in the shared worksheet context
            # while the current block contains only conditions/answer frames.
            # The structurer, not the extractor, owns the student-facing split.
            apparatus = clean_noise(body)
            payload["_raw_question_text"] = set_text if apparatus in set_text else compact(f"{set_text} {apparatus}")
        if payload["skill"] == "insertion":
            stimulus = re.match(r"^(.+?[.!?])\s+(?=[A-Z(])", set_text)
            if stimulus:
                payload["stimulus"] = stimulus.group(1)
                payload["set_text"] = set_text[stimulus.end():].strip()
        if written:
            answer_key = f"{exam_index}:{number}"
            accepted_answers = written_answers.get(answer_key) if written_answers else embedded_written_answers.get(number)
            if not isinstance(accepted_answers, list) or not accepted_answers:
                raise ValueError(f"exam {exam_index} q{number}: missing private written answer")
            slots = response_slots(accepted_answers)
            payload.update({"accepted_answers": accepted_answers, "response_slots": slots, "writing_guide": writing_guide(prompt, body, slots)})
            question_type = "written_response"
        else:
            if len(choices) != 5 or any(not choice for choice in choices):
                raise ValueError(f"exam {exam_index} q{number}: invalid choices")
            parts = choice_parts(set_text, choices)
            payload.update({"choices": choices, "answer": answers[number], "multi_select": len(answers[number] or []) > 1})
            if parts:
                payload["choice_parts"] = parts
            targets = target_ranges(set_text, prompt)
            if targets:
                payload["target_ranges"] = targets
            question_type = "multiple_choice"
        attach_spec(payload, question_type)
        questions.append({"passage_key": f"ne-minbyeongcheon-l{lesson}", "type": question_type, "status": "available", "payload": payload})
        if next_context:
            current_context = clean_noise(next_context)
    return questions


def validate(manifest: dict) -> dict:
    questions = manifest["questions"]
    errors = []
    identities = set()
    for question in questions:
        payload = question["payload"]
        source = payload["source"]
        identity = (source["exam"], source["source_question_no"])
        if identity in identities:
            errors.append(f"duplicate identity: {identity}")
        identities.add(identity)
        if len(payload.get("set_text", "")) < 20:
            errors.append(f"short context: {identity}")
        if question["type"] == "multiple_choice" and len(payload.get("choices", [])) != 5:
            errors.append(f"choice count: {identity}")
        if question["type"] == "written_response" and not payload.get("accepted_answers"):
            errors.append(f"written answer: {identity}")
        if len(payload.get("explanation", "")) < 8:
            errors.append(f"explanation: {identity}")
    stats = {
        "lessons": len(manifest["lessons"]),
        "questions": len(questions),
        "objective": sum(q["type"] == "multiple_choice" for q in questions),
        "written": sum(q["type"] == "written_response" for q in questions),
        "sets": len({q["payload"]["source"]["set_id"] for q in questions}),
        "explanations": sum(bool(q["payload"].get("explanation")) for q in questions),
        "errors": errors,
    }
    if stats["questions"] != 160 or stats["objective"] != 131 or stats["written"] != 29 or stats["explanations"] != 160 or errors:
        raise ValueError(f"manifest contract failed: {stats}")
    return stats


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("textbook", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--written-answers", type=Path, help="Optional audited override JSON keyed by exam-index:question-number")
    parser.add_argument("--downloads", type=Path, default=Path("/Users/kosangbum/Downloads"))
    args = parser.parse_args()
    paths = source_paths(args.downloads)
    missing = [str(path) for path in [args.textbook, *paths] if not path.exists()]
    if args.written_answers and not args.written_answers.exists():
        missing.append(str(args.written_answers))
    if missing:
        raise FileNotFoundError("\n".join(missing))
    written_answers = json.loads(args.written_answers.read_text(encoding="utf-8")) if args.written_answers else None
    expected_written_keys = {f"{exam_index}:{number}" for exam_index, numbers in enumerate(WRITTEN, 1) for number in numbers}
    if written_answers is not None and set(written_answers) != expected_written_keys:
        raise ValueError("private written-answer identity contract failed")
    manifest = {"lessons": textbook_lessons(args.textbook), "questions": []}
    for index, path in enumerate(paths, 1):
        manifest["questions"].extend(extract_exam(path, index, written_answers))
    lesson_text = {index + 1: " ".join(row["text"] for row in lesson["rows"]) for index, lesson in enumerate(manifest["lessons"])}
    for question in manifest["questions"]:
        payload = question["payload"]
        lesson = int(payload["source"]["passage_no"])
        payload["source_kind"] = source_kind(payload.get("set_text", ""), lesson_text[lesson])
    stats = validate(manifest)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
