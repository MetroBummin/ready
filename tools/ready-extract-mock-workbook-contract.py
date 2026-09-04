#!/usr/bin/env python3
"""Compile passage-scoped READY catalogs from a combined mock-exam workbook.

The source PDF contains many numbered passages followed by a combined Answer
Key.  Each output catalog remains tied to one existing READY passage; this tool
does not create or modify passage/question data.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import random
import re
from pathlib import Path

from pypdf import PdfReader


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("ready_workbook_contract", HERE / "ready-extract-workbook-contract.py")
BASE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(BASE)


def question_for_page(text: str) -> int | None:
    head = text[:500]
    patterns = [r"(?<!\d)(\d{2})번\s+WORKBOOK1", r"WORKBOOK\d+[^\n]{0,100}?\s(\d{2})번\s+2026년", r"(?<!\d)(\d{2})번\s+2026년"]
    for pattern in patterns:
        if match := re.search(pattern, head):
            return int(match.group(1))
    return None


def stage_for_page(text: str) -> int | None:
    if match := re.search(r"WORKBOOK\s*(10|[2-9])\b", text[:500]):
        return int(match.group(1))
    return None


def clean_exercise_pages(value: str) -> str:
    value = re.sub(r"WORKBOOK\s*(?:10|[2-9])[^\n]*?┃고2", " ", value)
    value = re.sub(r"-\s*\d+\s*-", " ", value)
    value = re.sub(r"WORKBOOK\s+[^\n]*?하세요\.", " ", value)
    return BASE.clean_page(value)


def paired_rows_with_markers(value: str) -> list[tuple[str, str, int]]:
    value = clean_exercise_pages(value)
    output, cursor, number = [], 0, 1
    while True:
        start_match = re.search(rf"(?<!\d){number}\.\s*", value[cursor:])
        if not start_match:
            break
        start = cursor + start_match.end()
        marker = re.search(r"(?<!\d)\d+\)\s*", value[start:])
        if not marker:
            raise ValueError(f"paired row {number}: answer marker missing")
        split, after = start + marker.start(), start + marker.end()
        next_match = re.search(rf"(?<!\d){number + 1}\.\s*", value[after:])
        end = after + next_match.start() if next_match else len(value)
        output.append((BASE.norm(value[start:split]), BASE.norm(value[after:end]), int(marker.group(0).split(")", 1)[0])))
        cursor, number = end, number + 1
    return output


def paired_rows(value: str) -> list[tuple[str, str]]:
    return [(source, prompt) for source, prompt, _marker in paired_rows_with_markers(value)]


def marker_paired_rows(value: str) -> list[tuple[str, str, int]]:
    """Parse publisher rows whose display and canonical numbers can differ."""
    value = clean_exercise_pages(value)
    markers, number, cursor = [], 1, 0
    while match := re.search(rf"(?<!\d){number}\)\s*", value[cursor:]):
        absolute_start, absolute_end = cursor + match.start(), cursor + match.end()
        markers.append((number, absolute_start, absolute_end))
        cursor, number = absolute_end, number + 1
    output = []
    for index, (marker_number, marker_start, marker_end) in enumerate(markers):
        previous_end = markers[index - 1][2] if index else 0
        before = value[previous_end:marker_start]
        source_markers = list(re.finditer(r"(?<!\d)\d{1,2}\.\s*", before))
        source = before[source_markers[-1].end():] if source_markers else before
        next_start = markers[index + 1][1] if index + 1 < len(markers) else len(value)
        after = value[marker_end:next_start]
        next_sources = list(re.finditer(r"(?<!\d)\d{1,2}\.\s*", after))
        prompt = after[:next_sources[-1].start()] if next_sources else after
        output.append((BASE.norm(source), BASE.norm(prompt), marker_number))
    return output


def answer_question_blocks(answer_text: str) -> dict[int, str]:
    starts = list(re.finditer(r"(?<!\d)(\d{2})번(?:\d+\))?WORKBOOK1(?!\d)", answer_text))
    return {int(start.group(1)): answer_text[start.start():(starts[index + 1].start() if index + 1 < len(starts) else len(answer_text))] for index, start in enumerate(starts)}


def answer_stage(block: str, question: int, stage: int) -> str:
    marker = re.search(rf"{question}번WORKBOOK{stage}\s*[^\d]*", block)
    if not marker:
        return ""
    next_stage = re.search(rf"{question}번WORKBOOK(?:10|[2-9])", block[marker.end():])
    return block[marker.end():marker.end() + (next_stage.start() if next_stage else len(block))]


def numbered_answers(value: str) -> list[list[str]]:
    starts = list(re.finditer(r"(?<!\d)(\d+)\)\s*", value))
    rows = []
    for index, start in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(value)
        rows.append([BASE.norm(item) for item in value[start.end():end].split("/") if BASE.norm(item)])
    return rows


def shuffled_words(sentence: str, seed: str) -> list[str]:
    tokens = re.findall(r"[A-Za-z]+(?:[’'][A-Za-z]+)*", sentence)
    if len(tokens) < 2:
        return []
    rng = random.Random(hashlib.sha256(seed.encode()).digest())
    for _attempt in range(20):
        candidate = list(tokens); rng.shuffle(candidate)
        if candidate != tokens and sum(left != right for left, right in zip(candidate, tokens)) >= (len(tokens) + 1) // 2:
            return candidate
    return list(reversed(tokens))


def compile_question(question: int, stage_pages: dict[int, str], answer_block: str, source: dict) -> tuple[dict, dict]:
    raw = {}
    for stage in (2, 3, 4, 5, 6, 10):
        try:
            raw[stage] = paired_rows(stage_pages.get(stage, ""))
        except Exception as error:
            raise ValueError(f"{question}: Stage {stage}: {error}") from error
    marked_stage5 = marker_paired_rows(stage_pages.get(5, ""))
    english = [item[0] for item in raw[2]]
    korean = [item[0] for item in raw[3]]
    if not english or len(english) != len(korean):
        raise ValueError(f"{question}: canonical Stage 2/3 rows differ")
    prefix = f"wb-2026-06-{question}"
    stages, unpublished, derived_fallbacks = [], [], []
    statuses = {str(stage): {"source": 0, "ready": 0, "invalid": 0} for stage in range(2, 10)}

    def publish(stage: int, number: int, fields: dict) -> None:
        fields.update({"key": f"{prefix}-s{stage}-{number:02d}", "stage": stage, "number": number})
        stage_items[stage].append(fields); statuses[str(stage)]["ready"] += 1

    def invalid(stage: int, number: int, reason: str) -> None:
        statuses[str(stage)]["invalid"] += 1; unpublished.append({"status": "INVALID", "stage": stage, "number": number, "reason": reason[:240]})

    stage_items = {stage: [] for stage in range(2, 10)}
    for stage in (2, 3, 4, 8, 9):
        statuses[str(stage)]["source"] = len(english)
    statuses["7"]["source"] = 1

    stage5_answers = numbered_answers(answer_stage(answer_block, question, 5))
    stage6_answers = numbered_answers(answer_stage(answer_block, question, 6))
    canonical_corpus = BASE.canonical_form(" ".join(english))

    def in_canonical_corpus(value: str) -> bool:
        candidate = BASE.canonical_form(value)
        if candidate in canonical_corpus:
            return True
        return re.sub(r"\s+", "", candidate) in re.sub(r"\s+", "", canonical_corpus)

    for index, (en, ko) in enumerate(zip(english, korean), 1):
        try: publish(2, index, {"kind": "blank_input", "source": en, "prompt": raw[2][index - 1][1], "answers": BASE.cloze(raw[2][index - 1][1], ko)})
        except Exception as error: invalid(2, index, str(error))
        try: publish(3, index, {"kind": "blank_input", "source": ko, "prompt": raw[3][index - 1][1], "answers": BASE.cloze(raw[3][index - 1][1], en)})
        except Exception as error: invalid(3, index, str(error))
        publish(4, index, {"kind": "translation_ai", "source": en, "prompt": "우리말 해석을 입력하세요.", "answers": [ko]})
        bank = shuffled_words(en, f"{prefix}:{index}")
        if bank: publish(8, index, {"kind": "reorder_groups", "source": ko, "prompt": "⟦ORDER:0⟧.", "groups": [bank], "answers": [" ".join(re.findall(r"[A-Za-z]+(?:[’'][A-Za-z]+)*", en)).lower()]})
        try:
            frame, word_bank = BASE.writing_frame(raw[10][index - 1][1], en); answers = BASE.cloze(frame, en)
            publish(9, index, {"kind": "blank_input", "source": raw[10][index - 1][0], "prompt": frame, "wordBank": word_bank, "answers": answers})
        except Exception as error:
            derived_fallbacks.append({"stage": 9, "number": index, "reason": str(error)[:240]})
            publish(9, index, {"kind": "blank_input", "source": ko, "prompt": "______________", "wordBank": [], "answers": [en], "provenance": {"derivedFallback": True, "reason": "publisher_frame_not_safely_structured"}})

    statuses["5"]["source"] = len(marked_stage5)
    for index, (source_text, publisher_prompt, answer_start) in enumerate(marked_stage5, 1):
        try:
            prompt, hints = BASE.marked(publisher_prompt, r"\(([^()]*)\)", "blank")
            answer_end = marked_stage5[index][2] if index < len(marked_stage5) else len(stage5_answers) + 1
            answers = [answer for row in stage5_answers[answer_start - 1:answer_end - 1] for answer in row]
            reconstructed = BASE.fill_frame(prompt, answers)
            if len(hints) != len(answers) or not in_canonical_corpus(reconstructed):
                raise ValueError("publisher Stage 5 slots do not reconstruct canonical passage text")
            publish(5, index, {"kind": "verb_form", "source": source_text, "prompt": prompt, "hints": hints, "answers": answers})
        except Exception as error:
            invalid(5, index, str(error))

    stage6_rows = []
    for source_text, publisher_prompt in raw[6]:
        groups = [[BASE.norm(option) for option in value.split("/")] for value in re.findall(r"\[([^\[\]]+)\]", publisher_prompt)]
        if groups:
            stage6_rows.append((source_text, publisher_prompt, groups))
    statuses["6"]["source"] = len(stage6_rows)
    for index, (source_text, publisher_prompt, groups) in enumerate(stage6_rows, 1):
        try:
            answers = stage6_answers[index - 1]
            if len(groups) != len(answers) or any(answer not in group for answer, group in zip(answers, groups)):
                raise ValueError("publisher Stage 6 choices and answers differ")
            counter = iter(range(len(groups)))
            frame = BASE.norm(re.sub(r"\[[^\[\]]+\]", lambda _match: f"⟦CHOICE:{next(counter)}⟧", publisher_prompt))
            rebuilt = frame
            for group_index, answer in enumerate(answers):
                rebuilt = rebuilt.replace(f"⟦CHOICE:{group_index}⟧", answer)
            if not in_canonical_corpus(rebuilt):
                raise ValueError("publisher Stage 6 answers do not reconstruct canonical passage text")
            publish(6, index, {"kind": "choice_groups", "source": source_text, "prompt": frame, "groups": groups, "answers": answers})
        except Exception as error:
            invalid(6, index, str(error))

    try:
        stage7_prompt = stage_pages[7]
        prompt_match = re.search(r"WORKBOOK\s+밑줄.*?1\)(.*?)(?=\(1\)\s*_{5,})", stage7_prompt, flags=re.S)
        prompt = BASE.norm(prompt_match.group(1)) if prompt_match else ""
        pairs = [(BASE.norm(wrong), BASE.norm(correct)) for _slot, wrong, correct in re.findall(r"\((\d+)\)\s*(.*?)\s*→\s*(.*?)(?=\(\d+\)\s*|$)", answer_stage(answer_block, question, 7), flags=re.S)]
        if not prompt or len(pairs) not in (2, 3): raise ValueError("publisher Stage 7 prompt or answer pairs missing")
        localized = [BASE.minimal_correction_pair(prompt, *pair) for pair in pairs]
        publish(7, 1, {"kind": "correction_pairs", "source": "", "prompt": prompt, "pairCount": len(localized), "subtype": "grammar", "answers": [value for pair in localized for value in pair], "publisherAnswers": [value for pair in pairs for value in pair]})
    except Exception as error: invalid(7, 1, str(error))

    for stage in range(2, 10):
        title, instruction = BASE.META[stage]
        stages.append({"stage": stage, "title": f"{stage}단계 · {title}", "instruction": instruction, "items": stage_items[stage]})
    report = {"source": source, "question": question, "exerciseStatus": statuses, "ready": sum(len(value) for value in stage_items.values()), "unpublished": unpublished, "derivedFallbacks": derived_fallbacks, "unsupported": {"1": "outside_requested_range", "10_source_stage_9": "paragraph_ordering_not_in_ready_contract"}}
    catalog = {"workbookKey": f"sol-direct-2026-06-{question}", "title": f"2026년 6월 {question}번 워크북", "source": source, "importReport": report, "unpublishedExercises": unpublished, "stages": stages}
    return catalog, report


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("pdf", type=Path); parser.add_argument("output", type=Path); parser.add_argument("--questions", default="18-24,26")
    args = parser.parse_args(); requested = []
    for part in args.questions.split(","):
        if "-" in part:
            start, end = map(int, part.split("-")); requested.extend(range(start, end + 1))
        else: requested.append(int(part))
    reader = PdfReader(args.pdf); pages = [page.extract_text() or "" for page in reader.pages]
    answer_start = next((index for index, text in enumerate(pages) if "10단계 WORKBOOK" in text and "정답" in text), -1)
    if answer_start < 0: raise ValueError("combined Answer Key missing")
    grouped: dict[int, dict[int, list[str]]] = {}
    current_question: int | None = None
    for text in pages[:answer_start]:
        question, stage = question_for_page(text), stage_for_page(text)
        if question is not None:
            current_question = question
        if current_question in requested and stage:
            grouped.setdefault(current_question, {}).setdefault(stage, []).append(text)
    answer_blocks = answer_question_blocks("\n".join(BASE.clean_answer_page(text) for text in pages[answer_start:]))
    source = {"sourceFile": args.pdf.name, "sha256": hashlib.sha256(args.pdf.read_bytes()).hexdigest(), "preserved": True, "scope": "2026-06 questions 18-26 excluding 25,27,28"}
    outputs, reports = {}, {}
    for question in requested:
        stage_values = {stage: "\n".join(values) for stage, values in grouped.get(question, {}).items()}
        catalog, report = compile_question(question, stage_values, answer_blocks.get(question, ""), source)
        outputs[str(question)] = catalog; reports[str(question)] = report
    args.output.write_text(json.dumps({"catalogs": outputs, "reports": reports}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(reports, ensure_ascii=False))


if __name__ == "__main__": main()
