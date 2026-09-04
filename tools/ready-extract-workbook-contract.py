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
    7: ("어색한 곳 찾기", "어색한 표현을 찾아 쓰고 알맞게 고쳐 쓰세요."),
    8: ("순서 배열", "주어진 단어와 어구를 눌러 문장 순서로 배열하세요."),
    9: ("영작 연습", "제시어와 문장 틀을 사용해 빈칸을 완성하세요."),
}

PAIRED_ROW_STAGES = (2, 3, 4, 5, 6, 8, 9)


def norm(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')).strip()


def canonical_form(value: str) -> str:
    """Normalize only typography that publisher text extraction can vary."""
    value = norm(value).lower().translate(str.maketrans({"‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-"}))
    value = re.sub(r"\s+([,.;:!?-])", r"\1", value)
    value = re.sub(r"([.!?;-])\s+", r"\1 ", value)
    value = re.sub(r"([.!?])([\"'])", r"\2\1", value)
    value = re.sub(r"\b(i|you|we|they)'re\b", r"\1 are", value)
    value = re.sub(r"\b(i)'m\b", r"\1 am", value)
    value = re.sub(r"\b(i|you|we|they)'ve\b", r"\1 have", value)
    value = re.sub(r"\b(i|you|he|she|it|we|they)'ll\b", r"\1 will", value)
    value = re.sub(r"\b(he|she|it|that|there|what|who)'s\b", r"\1 is", value)
    value = re.sub(r"\blet's\b", "let us", value)
    return value


def same_canonical(left: str, right: str) -> bool:
    """Compare one publisher row with its corresponding canonical sentence.

    PDF extraction may join a heading to its sentence or add a space at that
    boundary.  Index alignment plus compact equality proves the same source
    row without searching the whole passage or guessing slot boundaries.
    """
    left_value, right_value = canonical_form(left), canonical_form(right)
    return left_value == right_value or re.sub(r"\s+", "", left_value) == re.sub(r"\s+", "", right_value)


def clean_page(value: str) -> str:
    value = re.sub(r"^.*?교과서 본문\s*", "", value, count=1, flags=re.S)
    value = re.sub(r"-\s*\d+\s*-", " ", value)
    return value


def clean_answer_page(value: str) -> str:
    """Remove repeated page furniture without discarding cross-page answers."""
    value = re.sub(r"Answer Key[^\n]*", " ", value)
    value = re.sub(r"10단계\s*WORKBOOK\s*정답[^\n]*", " ", value)
    value = re.sub(r"-\s*\d+\s*-", " ", value)
    return value


def page_texts(reader: PdfReader) -> list[str]:
    """Extract each PDF page once for the lifetime of this import.

    Workbook stages and answer-key readers revisit the same pages many times.
    Re-running pypdf extraction for every stage made a single workbook import
    CPU-bound for minutes and encouraged operators to bypass the audited path.
    """
    cached = getattr(reader, "_ready_page_texts", None)
    if cached is None:
        cached = [page.extract_text() or "" for page in reader.pages]
        setattr(reader, "_ready_page_texts", cached)
    return cached


def stage_pages(reader: PdfReader, stage: int) -> list[int]:
    found = []
    for index, value in enumerate(page_texts(reader)):
        if "Answer Key" in value or "본문 외 지문" in value:
            continue
        if re.search(rf"워크북\s*{stage}", value):
            found.append(index)
    return found


def rows(reader: PdfReader, stage: int) -> list[tuple[str, str]]:
    pages = stage_pages(reader, stage)
    if not pages:
        raise ValueError(f"stage {stage}: pages missing")
    texts = page_texts(reader)
    value = "\n".join(clean_page(texts[index]) for index in pages)
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
    if any(not part and index not in (0, len(parts) - 1) for index, part in enumerate(parts)):
        raise ValueError("adjacent blanks have no fixed boundary")
    folded, cursor, answers = canonical.casefold(), 0, []
    if parts[0]:
        if not folded.startswith(parts[0].casefold()):
            raise ValueError(f"frame does not reproduce canonical sentence: {template!r}")
        cursor = len(parts[0])
    for index, tail in enumerate(parts[1:], 1):
        if tail:
            at = folded.find(tail.casefold(), cursor)
            if at < cursor:
                raise ValueError(f"frame does not reproduce canonical sentence: {template!r}")
            answers.append(norm(canonical[cursor:at])); cursor = at + len(tail)
        elif index == len(parts) - 1:
            answers.append(norm(canonical[cursor:])); cursor = len(canonical)
    if cursor != len(canonical):
        raise ValueError(f"frame does not reproduce canonical sentence: {template!r}")
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
    canonical_corpus = canonical_form(corpus)
    compact_corpus = re.sub(r"\s+", "", canonical_corpus)
    for combination in itertools.product(*groups):
        values = iter(combination)
        sentence = norm(re.sub(r"\[[^\[\]]+\]", lambda _match: next(values), prompt))
        candidate = canonical_form(sentence)
        if candidate in canonical_corpus or re.sub(r"\s+", "", candidate) in compact_corpus:
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


def fill_frame(frame: str, answers: list[str]) -> str:
    """Fill one publisher answer into each explicit workbook slot."""
    parts = re.split(r"_{5,}", norm(frame))
    if len(parts) - 1 != len(answers):
        raise ValueError("answer slots and publisher answers differ")
    output = [parts[0]]
    for answer, tail in zip(answers, parts[1:]):
        output.extend([answer, tail])
    return norm("".join(output))


def stage5_answer_items(reader: PdfReader, expected_count: int) -> list[list[str]]:
    """Read slash-separated Stage 5 slot answers from the publisher Answer Key.

    Some books contain a second supplementary Stage 5 section. The executable
    textbook section is the unique answer-key block whose numbered row count
    matches the Stage 5 exercise count extracted from the textbook pages.
    """
    answer_text = "\n".join(clean_answer_page(value) for value in page_texts(reader) if "Answer Key" in value)
    candidates: list[list[list[str]]] = []
    for marker in re.finditer(r"워크북\s*5\s*동사형\s*연습", answer_text):
        following = answer_text[marker.end():]
        next_stage = re.search(r"워크북\s*6", following)
        block = following[:next_stage.start() if next_stage else len(following)]
        starts = list(re.finditer(r"(?<!\d)(\d+)\)\s*", block))
        if [int(start.group(1)) for start in starts] != list(range(1, expected_count + 1)):
            continue
        rows = []
        for index, start in enumerate(starts):
            end = starts[index + 1].start() if index + 1 < len(starts) else len(block)
            value = re.sub(r"\s*Answer Key.*$", "", block[start.end():end], flags=re.S)
            answers = [norm(answer) for answer in value.split("/")]
            if not answers or any(not answer for answer in answers):
                raise ValueError(f"stage 5 item {index + 1}: empty publisher answer slot")
            rows.append(answers)
        candidates.append(rows)
    if len(candidates) != 1:
        raise ValueError(f"stage 5: found {len(candidates)} matching publisher answer-key blocks")
    return candidates[0]


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


def reorder_answers(prompt: str, groups: list[list[str]], canonical: str) -> list[str]:
    """Solve all ORDER groups jointly against the publisher sentence.

    Adjacent groups make a regex capture boundary ambiguous, so the solver
    consumes fixed prompt text and every chip in one left-to-right proof.  A
    common chip can therefore never be borrowed from text outside its group.
    """
    prompt, canonical_source = norm(prompt), norm(canonical)
    prompt = re.sub(r"([.!?])([\"'])", r"\2\1", prompt)
    canonical = re.sub(r"([.!?])([\"'])", r"\2\1", canonical_source)
    parts = re.split(r"\([^()]*\)", prompt)
    if len(parts) - 1 != len(groups):
        raise ValueError("reorder groups and prompt slots differ")
    chips = [[norm(chip) for chip in group] for group in groups]
    solutions: set[tuple[str, ...]] = set()

    def fixed_end(position: int, value: str) -> int | None:
        pattern = re.escape(value).replace(r"\ ", r"\s+")
        match = re.compile(pattern, flags=re.I).match(canonical, position)
        return match.end() if match else None

    def consume_group(group_index: int, position: int, remaining: tuple[int, ...], sequence: tuple[str, ...], answers: tuple[str, ...]) -> None:
        if not remaining:
            consume_frame(group_index + 1, position, answers + (" ".join(sequence),))
            return
        if len(solutions) > 1:
            return
        if sequence:
            while position < len(canonical) and canonical[position].isspace():
                position += 1
        for index in sorted(remaining, key=lambda value: len(chips[group_index][value]), reverse=True):
            chip = chips[group_index][index]
            end = position + len(chip)
            if canonical[position:end].casefold() != chip.casefold():
                continue
            if end < len(canonical) and canonical[end].isalnum() and chip[-1:].isalnum():
                continue
            consume_group(group_index, end, tuple(value for value in remaining if value != index), sequence + (chip,), answers)

    def consume_frame(group_index: int, position: int, answers: tuple[str, ...]) -> None:
        position = fixed_end(position, parts[group_index])
        if position is None:
            return
        if group_index == len(groups):
            if position == len(canonical):
                solutions.add(answers)
            return
        consume_group(group_index, position, tuple(range(len(chips[group_index]))), (), answers)

    consume_frame(0, 0, ())
    if len(solutions) != 1:
        raise ValueError(f"reorder frame has {len(solutions)} exact publisher reconstructions")
    answers = list(next(iter(solutions)))
    reconstructed = parts[0]
    for answer, tail in zip(answers, parts[1:]):
        reconstructed += answer + tail
    if canonical_form(reconstructed) != canonical_form(canonical_source):
        raise ValueError("reorder answers do not round-trip to canonical sentence")
    return answers


def complete_reorder_frame(prompt: str, canonical: str) -> str:
    """Restore terminal punctuation omitted by the PDF's chip-bank text layer."""
    prompt, canonical = norm(prompt), norm(canonical)
    terminal = re.search(r"([.!?]+)$", canonical)
    final_options = [norm(value) for value in re.findall(r"\(([^()]*)\)", prompt)[-1].split("/")] if re.findall(r"\(([^()]*)\)", prompt) else []
    punctuation_is_a_chip = bool(terminal and terminal.group(1) in final_options)
    if terminal and not punctuation_is_a_chip and not re.search(r"[.!?]+$", prompt):
        prompt += terminal.group(1)
    return prompt


def merge_adjacent_reorder_groups(prompt: str, groups: list[list[str]]) -> tuple[str, list[list[str]]]:
    """A whitespace-only PDF split is presentation, not a second exercise slot."""
    marker_index = iter(range(len(groups)))
    marked = re.sub(r"\([^()]+\)", lambda _match: f"⟦ORDER:{next(marker_index)}⟧", norm(prompt))
    groups = [list(group) for group in groups]
    adjacent = re.compile(r"⟦ORDER:(\d+)⟧\s+⟦ORDER:(\d+)⟧")
    while match := adjacent.search(marked):
        left, right = map(int, match.groups())
        if right != left + 1:
            raise ValueError("adjacent reorder markers are not sequential")
        groups[left].extend(groups[right]); del groups[right]
        marked = marked[:match.start()] + f"⟦ORDER:{left}⟧" + marked[match.end():]
        marked = re.sub(r"⟦ORDER:(\d+)⟧", lambda item: f"⟦ORDER:{int(item.group(1)) - (int(item.group(1)) > right)}⟧", marked)
    rebuilt = re.sub(r"⟦ORDER:(\d+)⟧", lambda item: f"({' / '.join(groups[int(item.group(1))])})", marked)
    return rebuilt, groups


def reorder_contract(prompt: str, groups: list[list[str]], candidates: list[str]) -> tuple[str, list[str]]:
    """Select the unique publisher sentence that the whole ORDER frame rebuilds."""
    solutions: dict[tuple[str, tuple[str, ...]], tuple[str, list[str]]] = {}
    for canonical in dict.fromkeys(norm(value) for value in candidates):
        candidate_prompt = complete_reorder_frame(prompt, canonical)
        try:
            answers = reorder_answers(candidate_prompt, groups, canonical)
        except ValueError:
            continue
        solutions[(canonical_form(canonical), tuple(answer.casefold() for answer in answers))] = (candidate_prompt, answers)
    if len(solutions) != 1:
        raise ValueError(f"reorder exercise has {len(solutions)} publisher-corpus round trips")
    return next(iter(solutions.values()))


def stage7_prompt_items(reader: PdfReader) -> list[tuple[str, int, str]]:
    """Read stage 7 passages; vector underlines are not needed for the response contract."""
    stage_texts = []
    for index in stage_pages(reader, 7):
        value = page_texts(reader)[index]
        if "본문 외 지문" not in value:
            stage_texts.append(value)
    value = " ".join(stage_texts)
    headings = list(re.finditer(r"(문맥상|어법상)\s*어색한 것 찾기", value))
    output = []
    for heading_index, heading in enumerate(headings):
        family = "context" if heading.group(1) == "문맥상" else "grammar"
        end = headings[heading_index + 1].start() if heading_index + 1 < len(headings) else len(value)
        section = value[heading.end():end]
        for match in re.finditer(r"(?<![\d(])(\d+)\)(.*?)(?=\(1\)\s*_{5,})", section, flags=re.S):
            output.append((family, int(match.group(1)), norm(match.group(2))))
    if not output:
        raise ValueError("stage 7: no executable passages")
    return output


def stage7_answer_items(reader: PdfReader) -> list[tuple[str, int, list[tuple[str, str]]]]:
    value = " ".join(clean_answer_page(text) for text in page_texts(reader) if "Answer Key" in text)
    output = []
    for marker in re.finditer(r"워크북\s*7\s*어색한 곳 찾기 연습", value):
        following = value[marker.end():]
        next_stage = re.search(r"워크북\s*8", following)
        block = following[:next_stage.start() if next_stage else len(following)]
        headings = list(re.finditer(r"(문맥상|어법상)\s*어색한 것 찾기", block))
        for heading_index, heading in enumerate(headings):
            family = "context" if heading.group(1) == "문맥상" else "grammar"
            end = headings[heading_index + 1].start() if heading_index + 1 < len(headings) else len(block)
            section = block[heading.end():end]
            starts = list(re.finditer(r"(?<!\d)(\d+)\)\s*\(1\)", section))
            for item_index, start in enumerate(starts):
                item_end = starts[item_index + 1].start() if item_index + 1 < len(starts) else len(section)
                item_text = section[start.end() - 3:item_end]
                pairs = [(norm(wrong), norm(correct)) for _number, wrong, correct in re.findall(
                    r"\((\d+)\)\s*(.*?)\s*→\s*(.*?)(?=\(\d+\)\s*|$)", item_text, flags=re.S
                )]
                if pairs:
                    output.append((family, int(start.group(1)), pairs))
    if not output:
        raise ValueError("stage 7: publisher answer key missing")
    return output


def minimal_correction_pair(prompt: str, wrong: str, correct: str) -> tuple[str, str]:
    """Reduce a publisher's underlined clause to the text the learner changes.

    Answer keys often repeat the entire underlined clause even when one word is
    wrong.  Stage 7 asks for the wrong expression and its replacement, so the
    response slots should contain the smallest unambiguous changed span.
    """
    wrong_words, correct_words = norm(wrong).split(), norm(correct).split()
    comparable = lambda value: canonical_form(value).strip(".,;:!?\"'")
    prefix = 0
    while prefix < min(len(wrong_words), len(correct_words)) and comparable(wrong_words[prefix]) == comparable(correct_words[prefix]):
        prefix += 1
    suffix = 0
    while suffix < min(len(wrong_words) - prefix, len(correct_words) - prefix) and comparable(wrong_words[-1 - suffix]) == comparable(correct_words[-1 - suffix]):
        suffix += 1
    wrong_end = len(wrong_words) - suffix if suffix else len(wrong_words)
    correct_end = len(correct_words) - suffix if suffix else len(correct_words)
    short_wrong = wrong_words[prefix:wrong_end]
    short_correct = correct_words[prefix:correct_end]
    if not short_wrong or not short_correct:
        if suffix:
            wrong_end += 1
            correct_end += 1
            short_wrong = wrong_words[prefix:wrong_end]
            short_correct = correct_words[prefix:correct_end]
        elif prefix:
            prefix -= 1
            short_wrong = wrong_words[prefix:wrong_end]
            short_correct = correct_words[prefix:correct_end]
    candidate = (norm(" ".join(short_wrong)), norm(" ".join(short_correct)))
    if not all(candidate):
        return norm(wrong), norm(correct)
    return candidate


def stage7_items(reader: PdfReader, prefix: str) -> list[dict]:
    prompts, answers = stage7_prompt_items(reader), stage7_answer_items(reader)
    queues: dict[tuple[str, int], list[list[tuple[str, str]]]] = {}
    for family, number, pairs in answers:
        queues.setdefault((family, number), []).append(pairs)
    items = []
    for index, (family, number, prompt) in enumerate(prompts, 1):
        candidates = queues.get((family, number), [])
        if not candidates:
            raise ValueError(f"stage 7 {family} item {number}: answer missing")
        publisher_pairs = candidates.pop(0)
        pairs = [minimal_correction_pair(prompt, wrong, correct) for wrong, correct in publisher_pairs]
        flat_answers = [value for pair in pairs for value in pair]
        items.append({"key": f"{prefix}-s7-{family}-{number:02d}", "stage": 7, "number": index,
                      "kind": "correction_pairs", "source": "", "prompt": prompt,
                      "pairCount": len(pairs), "subtype": family, "answers": flat_answers,
                      "publisherAnswers": [value for pair in publisher_pairs for value in pair]})
    return items


def compile_catalog(pdf: Path, key: str, title: str, prefix: str) -> tuple[dict, dict]:
    reader = PdfReader(pdf)
    raw = {stage: rows(reader, stage) for stage in PAIRED_ROW_STAGES}
    english = [source for source, _prompt in raw[2]]
    korean = [source for source, _prompt in raw[3]]
    corpus = norm(" ".join(english))
    canonical_corpus = canonical_form(corpus)
    reorder_corpus = list(english)
    for value in english:
        reorder_corpus.extend(part for part in re.split(r"(?<=[.!?])\s+(?=[A-Z])", norm(value)) if part)
    stage5_answers = stage5_answer_items(reader, len(raw[5]))
    unpublished = []
    stages, statuses = [], {str(stage): {"source": len(items), "ready": 0, "invalid": 0} for stage, items in raw.items()}
    stage7 = stage7_items(reader, prefix)
    statuses["7"] = {"source": len(stage7), "ready": len(stage7), "invalid": 0}
    for stage in META:
        if stage == 7:
            stage_title, instruction = META[stage]
            stages.append({"stage": stage, "title": f"{stage}단계 · {stage_title}", "instruction": instruction, "items": stage7})
            continue
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
                    answers = stage5_answers[index]
                    if len(hints) != len(answers): raise ValueError("verb hints and publisher answer slots differ")
                    reconstructed = fill_frame(frame, answers)
                    if index >= len(english) or not same_canonical(reconstructed, english[index]):
                        raise ValueError("publisher slot answers do not reconstruct the corresponding canonical sentence")
                    item = {"kind": "verb_form", "source": source, "prompt": frame, "hints": hints, "answers": answers}
                elif stage == 6:
                    groups = [[norm(option) for option in value.split("/")] for value in re.findall(r"\[([^\[\]]+)\]", prompt)]
                    frame, _ = marked(prompt, r"\[([^\[\]]+)\]", "choice")
                    answers = choice_answers(prompt, groups, corpus)
                elif stage == 8:
                    groups = [[norm(option) for option in value.split("/")] for value in re.findall(r"\(([^()]*)\)", prompt)]
                    prompt, groups = merge_adjacent_reorder_groups(prompt, groups)
                    prompt, answers = reorder_contract(prompt, groups, reorder_corpus)
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
    report = {"source": provenance, "exerciseStatus": statuses, "unsupported": {"1": "outside_requested_range", "10": "outside_requested_range"}, "ready": sum(len(stage["items"]) for stage in stages)}
    return {"workbookKey": key, "title": title, "source": provenance, "importReport": report, "unpublishedExercises": unpublished, "stages": stages}, report


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("pdf", type=Path); parser.add_argument("output", type=Path); parser.add_argument("--key", required=True); parser.add_argument("--title", required=True); parser.add_argument("--prefix", required=True); parser.add_argument("--export", required=True)
    args = parser.parse_args(); catalog, report = compile_catalog(args.pdf, args.key, args.title, args.prefix)
    args.output.write_text(f"export const {args.export} = " + json.dumps(catalog, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__": main()
