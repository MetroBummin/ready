#!/usr/bin/env python3
"""Extract verified explanations for READY's 2026-06 Busan questions.

The publisher PDF remains private.  This tool emits only a local import
manifest and never places the source content in the repository.  Explanation
identity is the immutable triple (exam, section, source question number).
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

from pypdf import PdfReader


EXAM = "2026-06 부산 고2 예상문제"
SECTION_QUESTIONS = {
    "1": list(range(1, 41)),
    "2": list(range(97, 138)),
    "3": list(range(211, 219)) + list(range(233, 241)) + list(range(255, 263)),
    "4": list(range(277, 301)) + list(range(343, 351)),
}


def compact(value: str) -> str:
    value = unicodedata.normalize("NFC", value or "").replace("\x00", " ")
    value = re.sub(r"\s+([,.;:!?])", r"\1", value)
    return re.sub(r"\s+", " ", value).strip()


def clean_explanation(value: str) -> str:
    # Page furniture can land in the middle of a question explanation because
    # PDF text extraction joins consecutive pages.  Remove only fixed publisher
    # furniture; the authored explanation itself is otherwise kept verbatim.
    value = re.sub(r"고2\s*[｜|]\s*2026년\s*6월\s*부산광역시\s*교육청\s*정답\s*및\s*해설", " ", value)
    value = re.sub(r"∎\s*예상문제\s*\(\s*통합본\s*\)\s*∎\s*학력평가", " ", value)
    value = re.sub(r"-\s*\d{1,3}\s*-", " ", value)
    value = re.sub(
        r"본\s*자료는\s*이그잼포유에서\s*제작하였습니다\..*?저작권\s*침해\s*행위\s*또한\s*금지하고\s*있습니다\.",
        " ",
        value,
        flags=re.S,
    )
    # Section/passage dividers sit between two numbered explanations and are
    # not part of either explanation.
    value = re.sub(r"Section\s*[❶❷❸❹]\s*\d{2}번\s*[^0-9]{0,30}?Section\s*[❶❷❸❹]", " ", value)
    value = re.sub(r"\d{2}번\s*[^0-9]{0,30}?Section\s*[❶❷❸❹]", " ", value)
    value = re.sub(r"Section\s*[❶❷❸❹]", " ", value)
    return compact(value)


def all_explanations(reader: PdfReader) -> dict[int, str]:
    pages = [page.extract_text() or "" for page in reader.pages]
    # The phrase also appears in front matter.  The actual answer book starts
    # in the latter half and repeats the phrase in every page header.
    start = next((index for index, text in enumerate(pages) if index >= len(pages) // 2 and "정답 및 해설" in text), None)
    if start is None:
        raise ValueError("정답 및 해설 section not found")
    area = "\n".join(pages[start:])

    candidates = []
    for match in re.finditer(r"(?<!\d)((?:\d\s*){1,3})\)\s+", area):
        number = int(re.sub(r"\s", "", match.group(1)))
        if 1 <= number <= 364:
            candidates.append((number, match.start(), match.end()))

    # Enforcing the complete 1..364 sequence prevents numbered examples,
    # percentages, and years inside prose from becoming false boundaries.
    positions = []
    cursor = 0
    for expected in range(1, 365):
        found = next((item for item in candidates if item[1] >= cursor and item[0] == expected), None)
        if not found:
            raise ValueError(f"explanation {expected}: heading not found")
        positions.append(found)
        cursor = found[2]

    explanations = {}
    for index, (number, _start, content_start) in enumerate(positions):
        end = positions[index + 1][1] if index + 1 < len(positions) else len(area)
        explanation = clean_explanation(area[content_start:end])
        if len(explanation) < 8:
            raise ValueError(f"explanation {number}: empty or too short")
        explanations[number] = explanation
    return explanations


def manifest(source: Path) -> dict:
    reader = PdfReader(str(source))
    explanations = all_explanations(reader)
    rows = [
        {
            "exam": EXAM,
            "section": section,
            "question_no": question_no,
            "explanation": explanations[question_no],
        }
        for section, question_numbers in SECTION_QUESTIONS.items()
        for question_no in question_numbers
    ]
    identities = {(row["exam"], row["section"], row["question_no"]) for row in rows}
    if len(rows) != 137 or len(identities) != 137:
        raise ValueError(f"READY explanation identity contract failed: {len(rows)} rows, {len(identities)} identities")
    dirty = [
        row["question_no"] for row in rows
        if "정답 및 해설" in row["explanation"] or re.search(r"Section\s*[❶❷❸❹]", row["explanation"])
    ]
    if dirty:
        raise ValueError(f"page furniture remains in explanations: {dirty}")
    return {
        "source": source.name,
        "count": len(rows),
        "explanations": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if not args.source.is_file():
        raise SystemExit(f"source PDF not found: {args.source}")
    result = manifest(args.source)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "count": result["count"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
