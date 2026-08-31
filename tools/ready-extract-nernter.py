#!/usr/bin/env python3
"""Extract a Nernter two-column question bank into READY's provider-neutral bundle.

This adapter owns only PDF reading order and publisher answer-key recovery. It
does not decide what the student renderer should infer: every row is handed to
the normal Question contract compiler and strict round-trip validator.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from pathlib import Path

import pdfplumber


CHOICE_MARKS = "①②③④⑤"
ANNOTATION_MARKS = dict(zip(CHOICE_MARKS, "ⓐⓑⓒⓓⓔ"))
CHOICE_INDEX = {mark: index for index, mark in enumerate(CHOICE_MARKS)}


def compact(value: str) -> str:
    value = unicodedata.normalize("NFC", value or "")
    value = value.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    value = re.sub(r"\s+([,.;:!?])", r"\1", value)
    return re.sub(r"\s+", " ", value).strip()


def english_word_count(value: str) -> int:
    return len(re.findall(r"[A-Za-z0-9]+(?:['’][A-Za-z]+)?", value or ""))


def pdf_columns(path: Path) -> tuple[str, list[dict], str]:
    problem_parts, problem_spans, answer_parts = [], [], []
    cursor = 0
    with pdfplumber.open(path) as pdf:
        for page_no, page in enumerate(pdf.pages, 1):
            full = page.extract_text() or ""
            answer_page = "정답지" in full
            middle = page.width / 2
            boxes = (
                (36, 45, middle - 5, page.height - 30),
                (middle + 5, 45, page.width - 36, page.height - 30),
            )
            for box in boxes:
                text = page.crop(box).extract_text(x_tolerance=1.5, y_tolerance=3, layout=True) or ""
                if answer_page:
                    answer_parts.append(text)
                    continue
                if problem_parts:
                    cursor += 1
                start = cursor
                problem_parts.append(text)
                cursor += len(text)
                problem_spans.append({"start": start, "end": cursor, "page": page_no, "bbox": [round(float(x), 2) for x in box]})
    return "\n".join(problem_parts), problem_spans, "\n".join(answer_parts)


def location_for(spans: list[dict], start: int, end: int) -> dict:
    candidates = [(max(0, min(end, span["end"]) - max(start, span["start"])), span) for span in spans]
    overlap, span = max(candidates, key=lambda item: item[0])
    return {"page": span["page"], "bbox": span["bbox"]} if overlap > 0 else {"page": None, "bbox": None}


def numbered_blocks(text: str, pattern: str, expected: int) -> list[tuple[int, int, int, str]]:
    matches = list(re.finditer(pattern, text, re.M))
    numbers = [int(match.group(1)) for match in matches]
    if numbers != list(range(1, expected + 1)):
        missing = sorted(set(range(1, expected + 1)) - set(numbers))
        raise ValueError(f"number sequence contract failed: found={len(numbers)}, missing={missing[:20]}")
    result = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        result.append((int(match.group(1)), match.start(), end, text[match.end():end]))
    return result


def answer_rows(answer_text: str) -> dict[int, dict]:
    blocks = numbered_blocks(answer_text, r"^\s*(\d{1,3})\s*번\s*-\s*", 224)
    result = {}
    for number, _start, _end, raw in blocks:
        copy = compact(raw)
        selected = re.match(r"^([①②③④⑤](?:\s*,\s*[①②③④⑤])*)", copy)
        result[number] = {
            "raw": copy,
            "objective_answer": [CHOICE_INDEX[mark] for mark in selected.group(1) if mark in CHOICE_INDEX] if selected else None,
        }
    return result


def split_prompt(raw: str) -> tuple[str, str]:
    marker = re.search(r"\[\s*\d+\s*-\s*\d+\s*\]", raw)
    if not marker:
        return "", compact(raw)
    return compact(raw[:marker.end()]), compact(raw[marker.end():])


def choice_suffix(body: str) -> tuple[str, list[str]]:
    positions = {mark: [match.start() for match in re.finditer(re.escape(mark), body)] for mark in CHOICE_MARKS}
    candidates = []
    for first in positions["①"]:
        cursor, picked = first, [first]
        for mark in CHOICE_MARKS[1:]:
            found = next((value for value in positions[mark] if value > cursor), None)
            if found is None:
                picked = []
                break
            picked.append(found)
            cursor = found
        if picked:
            candidates.append(picked)
    if not candidates:
        return body, []
    picked = candidates[-1]
    # An annotation-only question has the five numbered targets but no answer
    # list after the passage. A real choice suffix is short enough to be rows,
    # or begins after the final sentence/paragraph boundary.
    suffix = body[picked[0]:]
    if len(suffix) > 700 or english_word_count(suffix) > 90:
        return body, []
    choices = []
    for index, start in enumerate(picked):
        end = picked[index + 1] if index < 4 else len(body)
        choices.append(compact(body[start + 1:end]))
    return compact(body[:picked[0]]), choices if all(choices) else []


def taxonomy(prompt: str, written: bool, multi: bool) -> str:
    if written:
        if "배열" in prompt:
            return "arrangement"
        if "고쳐" in prompt or "어색한" in prompt:
            return "correction"
        if "해석" in prompt:
            return "translation"
        if "요약" in prompt:
            return "summary_completion"
        return "guided_writing"
    if "어법" in prompt:
        if "네모" in prompt or "각" in prompt and "표현" in prompt:
            return "grammar_ab"
        return "grammar_multi_error" if multi else "grammar_single_error"
    if "문맥상" in prompt or "낱말" in prompt or "어휘" in prompt:
        return "vocabulary_context"
    if "주어진 문장" in prompt and "들어가" in prompt:
        return "sentence_insertion"
    if "관계없는" in prompt or "무관" in prompt:
        return "irrelevant_sentence"
    if "순서" in prompt:
        return "paragraph_order"
    if "요약" in prompt:
        return "summary_two_blank"
    if "빈칸" in prompt:
        return "blank_phrase"
    if "제목" in prompt:
        return "title"
    if "주제" in prompt:
        return "topic"
    if "요지" in prompt:
        return "main_idea"
    if "목적" in prompt:
        return "purpose"
    if "심경" in prompt or "분위기" in prompt:
        return "emotion"
    if "답할 수 없는" in prompt:
        return "unanswerable"
    if "일치하지" in prompt or "않는" in prompt and "내용" in prompt:
        return "content_false"
    return "content_true"


def family(taxonomy_name: str, written: bool) -> str:
    if written:
        return "written"
    if taxonomy_name in {"grammar_single_error", "grammar_multi_error", "vocabulary_context", "grammar_ab"}:
        return "annotated"
    if taxonomy_name in {"sentence_insertion", "irrelevant_sentence", "paragraph_order"}:
        return "structural"
    if taxonomy_name == "summary_two_blank":
        return "summary"
    return "standard"


def split_summary(body: str) -> tuple[str, str]:
    marker = re.search(r"\[\s*요약\s*\]", body)
    if not marker:
        return body, ""
    return compact(body[:marker.start()]), compact(body[marker.end():])


def split_insertion_stimulus(body: str) -> tuple[str, str]:
    position = re.search(r"\(\s*①\s*\)", body)
    if not position:
        return body, ""
    before = body[:position.start()]
    sentences = list(re.finditer(r"[.!?](?:\s+|$)", before))
    if len(sentences) < 2:
        return body, ""
    first_end = sentences[0].end()
    stimulus = compact(before[:first_end])
    passage = compact(before[first_end:] + body[position.start():])
    return passage, stimulus


def normalize_positions(body: str) -> str:
    for mark, label in ANNOTATION_MARKS.items():
        body = re.sub(rf"\(\s*{re.escape(mark)}\s*\)|{re.escape(mark)}", label, body)
    return body


def normalize_inline_annotations(body: str) -> str:
    for mark, label in ANNOTATION_MARKS.items():
        body = re.sub(rf"(?<![\w]){re.escape(mark)}\s*", f"{label}", body)
    return body


def accepted_answer_slots(raw: str) -> list:
    value = compact(raw)
    labelled = list(re.finditer(r"\(([A-C]|\d+)\)\s*", value))
    if labelled and labelled[0].start() < 20:
        slots = []
        for index, match in enumerate(labelled):
            end = labelled[index + 1].start() if index + 1 < len(labelled) else len(value)
            chunk = value[match.end():end]
            chunk = re.split(r"(?=[가-힣])", chunk, maxsplit=1)[0].strip(" ,;/")
            alternatives = re.findall(r"(?:또는|or)\s+([A-Za-z][A-Za-z '\-]+)", value[match.end():end])
            primary = re.split(r"\s*\((?:또는|or)\b", chunk, maxsplit=1)[0].strip(" ,;/")
            variants = [primary, *[compact(item) for item in alternatives]]
            variants = [item for item in dict.fromkeys(variants) if item]
            slots.append(variants if len(variants) > 1 else variants[0] if variants else "")
        if slots and all(slots):
            return slots
    correction = re.findall(r"([①②③④⑤ⓐ-ⓔ])\s*([^,가-힣]{1,80}?)\s*:\s*([^,가-힣]{1,80})(?=,|[가-힣]|$)", value)
    if correction:
        return [compact(f"{ANNOTATION_MARKS.get(label, label)} {fixed}") for label, _wrong, fixed in correction]
    english = re.split(r"(?=[가-힣])", value, maxsplit=1)[0].strip()
    english = re.sub(r"^\[예시답안\]\s*", "", english)
    if english:
        parts = [compact(item) for item in re.split(r"\s*/\s*(?=\(\d+\))", english) if compact(item)]
        return parts or [english]
    korean = re.split(r"['\"]", value, maxsplit=1)[0].strip()
    return [korean] if korean else []


def response_slots(answers: list) -> list[dict]:
    result = []
    for index, slot in enumerate(answers):
        variants = slot if isinstance(slot, list) else [slot]
        counts = {english_word_count(value) for value in variants if english_word_count(value)}
        result.append({"label": "답" if len(answers) == 1 else f"답 {index + 1}", "word_count": next(iter(counts)) if len(counts) == 1 else None})
    return result


def detach_shared_groups(problems: list[tuple[int, int, int, str]]) -> tuple[list[tuple[int, int, int, str]], dict[int, str]]:
    """Move explicit ``[122-123] 다음 글`` blocks to their named questions.

    The visual PDF prints the shared passage before the first child question,
    so reading-order extraction legitimately places it at the end of the
    preceding numbered block. The range label, not adjacency, is the contract.
    """
    contexts: dict[int, str] = {}
    cleaned = []
    marker_re = re.compile(r"\[\s*(\d{1,3})\s*-\s*(\d{1,3})\s*\]\s*다음\s*글(?:을|를)\s*읽고\s*물음에\s*답하시오\.?", re.S)
    for number, start, end, raw in problems:
        marker = marker_re.search(raw)
        if not marker:
            cleaned.append((number, start, end, raw))
            continue
        shared = raw[marker.end():]
        for child in range(int(marker.group(1)), int(marker.group(2)) + 1):
            contexts[child] = compact(shared)
        cleaned.append((number, start, end, raw[:marker.start()]))
    return cleaned, contexts


def spec_for(taxonomy_name: str, family_name: str, written: bool, multi: bool, extras: list[str]) -> dict:
    renderer = "written_input" if written else {"standard": "standard_mcq", "annotated": "annotated_passage_mcq", "structural": "structural", "summary": "summary"}[family_name]
    return {
        "renderer": renderer,
        "passage": {"source": "authored_variant", "annotations": []},
        "extras": extras,
        "choiceMode": "none" if written else "multi" if multi else "single",
        "responseMode": "input" if written else "choice",
        "gradingMode": "accepted_variants" if written else "exact_set" if multi else "exact",
        "importStatus": "ready",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--canonical-bundle", type=Path, help="Existing READY bundle containing the canonical Passage rows")
    args = parser.parse_args()
    if not args.pdf.is_file():
        raise FileNotFoundError(args.pdf)
    problem_text, spans, answer_text = pdf_columns(args.pdf)
    problems, shared_contexts = detach_shared_groups(numbered_blocks(problem_text, r"^\s*(\d{1,3})\.\s+", 224))
    answers = answer_rows(answer_text)
    digest = hashlib.sha256(args.pdf.read_bytes()).hexdigest()
    questions = []
    for number, start, end, raw in problems:
        prompt, body = split_prompt(raw)
        if not prompt:
            raise ValueError(f"question {number}: prompt boundary missing")
        if number in shared_contexts:
            body = compact(f"{shared_contexts[number]} {body}")
        if not body:
            body = "Missing source evidence"
        publisher = answers[number]
        written = "주관식" in prompt or publisher["objective_answer"] is None
        answer = publisher["objective_answer"]
        multi = bool(answer and len(answer) > 1)
        taxonomy_name = taxonomy(prompt, written, multi)
        family_name = family(taxonomy_name, written)
        implicit_marker_taxonomies = {"sentence_insertion", "grammar_single_error", "grammar_multi_error", "vocabulary_context", "irrelevant_sentence"}
        passage, choices = (body, []) if written or taxonomy_name in implicit_marker_taxonomies else choice_suffix(body)
        summary_text, stimulus, extras = "", "", []
        if taxonomy_name in {"summary_two_blank", "summary_completion"}:
            passage, summary_text = split_summary(passage)
            if summary_text:
                extras.append("summary")
        if taxonomy_name == "sentence_insertion":
            passage, stimulus = split_insertion_stimulus(passage)
            if stimulus:
                extras.append("stimulus")
            passage = normalize_positions(passage)
            choices = list(ANNOTATION_MARKS.values())
        if not written and not choices:
            if taxonomy_name in {"grammar_single_error", "grammar_multi_error", "vocabulary_context", "irrelevant_sentence"}:
                choices = list(ANNOTATION_MARKS.values())
                passage = normalize_inline_annotations(passage)
            else:
                choices = [str(index) for index in range(1, 6)]
        location = location_for(spans, start, end)
        source = {
            "provider": "nernter",
            "exam": "공통영어2 능률(민병천) 너른터 1단원",
            "passage_no": 1,
            "source_question_no": number,
            "section": "1",
            "set_id": "nernter-ne-minbyeongcheon-l1",
            "document_sha256": digest,
            "source_file": args.pdf.name,
            "page": location["page"],
            "bbox": location["bbox"],
        }
        payload = {
            "family": family_name,
            "skill": taxonomy_name,
            "taxonomy": taxonomy_name,
            "prompt": prompt,
            "position": 10000 + number,
            "set_text": compact(passage),
            "variant_text": compact(passage),
            "variant_mode": "authored_variant",
            "source_kind": "textbook_main",
            "source": source,
            "explanation": publisher["raw"],
            "import_status": "ready",
            "spec": spec_for(taxonomy_name, family_name, written, multi, extras),
            "_raw_question_text": compact(body),
        }
        if summary_text:
            payload["summary_text"] = compact(summary_text)
        if stimulus:
            payload["stimulus"] = compact(stimulus)
        if written:
            accepted = accepted_answer_slots(publisher["raw"])
            if not accepted:
                accepted = [publisher["raw"]]
            slots = response_slots(accepted)
            payload.update({
                "accepted_answers": accepted,
                "response_slots": slots,
                "writing_guide": {"kind": "summary" if taxonomy_name == "summary_completion" else "sentence", "title": prompt, "slot_labels": [slot["label"] for slot in slots], "conditions": [], "word_bank": [], "task_text": "", "targets": []},
            })
            question_type = "written_response"
        else:
            payload.update({"choices": choices, "answer": answer, "multi_select": multi})
            question_type = "multiple_choice"
        questions.append({"passage_key": "ne-minbyeongcheon-l1", "type": question_type, "status": "available", "payload": payload})
    stats = {
        "provider": "nernter",
        "questions": len(questions),
        "objective": sum(item["type"] == "multiple_choice" for item in questions),
        "written": sum(item["type"] == "written_response" for item in questions),
        "document_sha256": digest,
    }
    lessons = []
    if args.canonical_bundle:
        canonical = json.loads(args.canonical_bundle.read_text(encoding="utf-8"))
        lessons = [item for item in canonical.get("lessons", []) if item.get("key") == "ne-minbyeongcheon-l1"]
        if len(lessons) != 1 or not lessons[0].get("rows"):
            raise ValueError("canonical Passage ne-minbyeongcheon-l1 is missing")
    bundle = {"provider": "nernter", "lessons": lessons, "questions": questions, "extraction": stats}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
