#!/usr/bin/env python3
"""Compile publisher 10-stage PDFs into fail-closed READY Workbook catalogs.

Only stages whose answers can be reconstructed from the publisher's own paired
English/Korean sentences are emitted. The PDF is always preserved; exercises
that cannot be proved are retained as unpublished INVALID records.
"""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import re
from pathlib import Path
from pypdf import PdfReader


META = {
    2: ("우리말 빈칸", "영문을 보고 우리말 해석의 빈칸을 완성하세요."),
    3: ("영문 빈칸", "우리말 해석을 보고 영문의 빈칸을 완성하세요."),
    4: ("해석 연습", "영문을 자연스러운 우리말로 해석하세요."),
    5: ("동사형", "주어진 동사를 문장에 맞는 형태로 고쳐 쓰세요."),
    6: ("어법 선택", "각 구간에서 어법상 알맞은 표현을 고르세요."),
    8: ("순서 배열", "주어진 단어와 어구를 눌러 문장 순서로 배열하세요."),
    9: ("영작 연습", "제시어와 문장 틀을 사용해 빈칸을 완성하세요."),
}


def norm(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')).strip()


def clean_page(value: str) -> str:
    value = re.sub(r"^.*?교과서 본문\s*", "", value, count=1, flags=re.S)
    value = re.sub(r"-\s*\d+\s*-", " ", value)
    return value


def stage_pages(reader: PdfReader, stage: int) -> list[int]:
    found = []
    for index, page in enumerate(reader.pages):
        value = page.extract_text() or ""
        if "Answer Key" in value or "본문 외 지문" in value:
            continue
        if re.search(rf"워크북\s*{stage}", value):
            found.append(index)
    return found


def rows(reader: PdfReader, stage: int) -> list[tuple[str, str]]:
    pages = stage_pages(reader, stage)
    if not pages:
        raise ValueError(f"stage {stage}: pages missing")
    value = "\n".join(clean_page(reader.pages[index].extract_text() or "") for index in pages)
    output, cursor, number = [], 0, 1
    while True:
        start_match = re.search(rf"(?<!\d){number}\.\s*", value[cursor:])
        if not start_match:
            break
        start = cursor + start_match.end()
        marker = re.search(rf"{number}\)\s*", value[start:])
        if not marker:
            raise ValueError(f"stage {stage} item {number}: paired marker missing")
        split = start + marker.start()
        after = start + marker.end()
        next_match = re.search(rf"(?<!\d){number + 1}\.\s*", value[after:])
        end = after + next_match.start() if next_match else len(value)
        output.append((norm(value[start:split]), value[after:end].strip()))
        cursor = end
        number += 1
    if not output:
        raise ValueError(f"stage {stage}: no numbered rows")
    return output


def cloze(template: str, canonical: str) -> list[str]:
    template, canonical = norm(template), norm(canonical)
    parts = re.split(r"_{5,}", template)
    if len(parts) < 2:
        raise ValueError("no blank frame")
    pattern = "^" + "(.+?)".join(re.escape(part).replace(r"\ ", r"\s+") for part in parts) + "$"
    match = re.match(pattern, canonical, flags=re.I)
    if not match:
        raise ValueError(f"frame does not reproduce canonical sentence: {template!r}")
    answers = [norm(value) for value in match.groups()]
    if any(not answer for answer in answers):
        raise ValueError("empty reconstructed answer")
    return answers


def cloze_in_corpus(template: str, corpus: str) -> list[str]:
    """Recover blanks when a workbook row groups sentences differently.

    The match must be unique in the publisher's full English corpus. Captures
    are deliberately bounded so a broken frame cannot consume another row.
    """
    template, corpus = norm(template), norm(corpus)
    parts = re.split(r"_{5,}", template)
    if len(parts) < 2 or not any(part.strip() for part in parts):
        raise ValueError("no anchored blank frame")
    pattern = "(.{1,60}?)".join(re.escape(part).replace(r"\ ", r"\s+") for part in parts)
    matches = list(re.finditer(pattern, corpus, flags=re.I))
    answers = {tuple(norm(value) for value in match.groups()) for match in matches}
    if len(answers) != 1:
        raise ValueError(f"frame has {len(answers)} publisher-corpus matches")
    result = list(next(iter(answers)))
    if any(not answer or len(answer.split()) > 8 for answer in result):
        raise ValueError("reconstructed answer is outside safe bounds")
    return result


def choice_answers(prompt: str, groups: list[list[str]], corpus: str) -> list[str]:
    """Select the sole publisher option combination present in the corpus."""
    candidates = []
    for combination in itertools.product(*groups):
        values = iter(combination)
        sentence = norm(re.sub(r"\[[^\[\]]+\]", lambda _match: next(values), prompt))
        if sentence.lower() in corpus.lower():
            candidates.append(list(combination))
    unique = {tuple(candidate) for candidate in candidates}
    if len(unique) != 1:
        raise ValueError(f"choice frame has {len(unique)} publisher-corpus matches")
    return list(next(iter(unique)))


def marked(template: str, expression: str, token: str) -> tuple[str, list[str]]:
    matches = list(re.finditer(expression, template)); groups = [norm(match.group(1)) for match in matches]
    parts, cursor = [], 0
    for match in matches:
        parts.extend([template[cursor:match.start()], " ______________ "]); cursor = match.end()
    parts.append(template[cursor:]); frame = norm("".join(parts))
    return frame, groups


def writing_frame(prompt: str, canonical: str) -> tuple[str, list[str]]:
    blank = prompt.find("_____")
    if blank < 0:
        raise ValueError("writing frame missing")
    head, tail, canonical_norm = prompt[:blank].rstrip(), prompt[blank:], norm(canonical)
    static, bank_text = "", head
    boundaries = [match.end() for match in re.finditer(r"\s{2,}|\n+", head)]
    for boundary in boundaries:
        candidate = norm(head[boundary:])
        if candidate and canonical_norm.lower().startswith(candidate.lower()):
            static, bank_text = candidate, head[:boundary]
            break
    bank = [norm(value) for value in re.split(r",", norm(bank_text)) if norm(value)]
    return norm(f"{static} {tail}"), bank


def ordered_group(group: list[str], canonical: str) -> str:
    occupied, positions = [], []
    for chip in sorted(group, key=len, reverse=True):
        candidates = [match.start() for match in re.finditer(re.escape(chip), canonical, flags=re.I)]
        start = next((value for value in candidates if not any(value < end and value + len(chip) > begin for begin, end in occupied)), None)
        if start is None:
            raise ValueError(f"reorder chip {chip!r} not in canonical")
        occupied.append((start, start + len(chip))); positions.append((start, chip))
    return " ".join(chip for _start, chip in sorted(positions))


def compile_catalog(pdf: Path, key: str, title: str, prefix: str) -> tuple[dict, dict]:
    reader = PdfReader(pdf)
    raw = {stage: rows(reader, stage) for stage in META}
    english = [source for source, _prompt in raw[2]]
    korean = [source for source, _prompt in raw[3]]
    corpus = norm(" ".join(english))
    unpublished = []
    stages, statuses = [], {str(stage): {"source": len(items), "ready": 0, "invalid": 0} for stage, items in raw.items()}
    for stage in META:
        items = []
        for index, (source, prompt) in enumerate(raw[stage]):
            number, item = index + 1, None
            try:
                if stage == 2:
                    answers = cloze(prompt, korean[index]); item = {"kind": "blank_input", "source": english[index], "prompt": prompt, "answers": answers}
                elif stage == 3:
                    answers = cloze(prompt, english[index]); item = {"kind": "blank_input", "source": korean[index], "prompt": prompt, "answers": answers}
                elif stage == 4:
                    item = {"kind": "translation_ai", "source": english[index], "prompt": "우리말 해석을 입력하세요.", "answers": [korean[index]]}
                elif stage == 5:
                    frame, hints = marked(prompt, r"\(([^()]*)\)", "blank")
                    try:
                        answers = cloze(frame, english[index])
                    except (IndexError, ValueError):
                        answers = cloze_in_corpus(frame, corpus)
                    if len(hints) != len(answers): raise ValueError("verb hints and answers differ")
                    item = {"kind": "verb_form", "source": source, "prompt": frame, "hints": hints, "answers": answers}
                elif stage == 6:
                    groups = [[norm(option) for option in value.split("/")] for value in re.findall(r"\[([^\[\]]+)\]", prompt)]
                    frame, _ = marked(prompt, r"\[([^\[\]]+)\]", "choice")
                    answers = choice_answers(prompt, groups, corpus)
                elif stage == 8:
                    groups = [[norm(option) for option in value.split("/")] for value in re.findall(r"\(([^()]*)\)", prompt)]
                    answers = [ordered_group(group, english[index]) for group in groups]
                    counter = iter(range(len(groups))); marked_prompt = re.sub(r"\([^()]+\)", lambda _m: f"⟦ORDER:{next(counter)}⟧", prompt)
                    item = {"kind": "reorder_groups", "source": source, "prompt": norm(marked_prompt), "groups": groups, "answers": answers}
                elif stage == 9:
                    frame, bank = writing_frame(prompt, english[index]); answers = cloze(frame, english[index])
                    item = {"kind": "blank_input", "source": source, "prompt": frame, "wordBank": bank, "answers": answers}
                if stage == 6:
                    counter = iter(range(len(groups))); marked_prompt = re.sub(r"\[[^\[\]]+\]", lambda _m: f"⟦CHOICE:{next(counter)}⟧", prompt)
                    item = {"kind": "choice_groups", "source": source, "prompt": norm(marked_prompt), "groups": groups, "answers": answers}
                item.update({"key": f"{prefix}-s{stage}-{number:02d}", "stage": stage, "number": number})
                items.append(item); statuses[str(stage)]["ready"] += 1
            except Exception as error:
                statuses[str(stage)]["invalid"] += 1
                unpublished.append({"status": "INVALID", "stage": stage, "number": number, "source": source, "prompt": norm(prompt), "reason": str(error)[:240]})
        stage_title, instruction = META[stage]
        stages.append({"stage": stage, "title": f"{stage}단계 · {stage_title}", "instruction": instruction, "items": items})
    provenance = {"sourceFile": pdf.name, "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "preserved": True}
    report = {"source": provenance, "exerciseStatus": statuses, "unsupported": {"1": "read_only_source", "7": "vector_underlines", "10": "mixed_check"}, "ready": sum(len(stage["items"]) for stage in stages)}
    return {"workbookKey": key, "title": title, "source": provenance, "importReport": report, "unpublishedExercises": unpublished, "stages": stages}, report


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("pdf", type=Path); parser.add_argument("output", type=Path); parser.add_argument("--key", required=True); parser.add_argument("--title", required=True); parser.add_argument("--prefix", required=True); parser.add_argument("--export", required=True)
    args = parser.parse_args(); catalog, report = compile_catalog(args.pdf, args.key, args.title, args.prefix)
    args.output.write_text(f"export const {args.export} = " + json.dumps(catalog, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__": main()
