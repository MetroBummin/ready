#!/usr/bin/env python3
"""Attach private PDF evidence to deterministic objective drops only.

The evidence is a temporary importer input. It must never be published or
committed. The AI fallback may use it to recover block/span boundaries, while
the prompt, choices, and publisher answer key remain immutable.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path


def load_extractor(path: Path):
    spec = importlib.util.spec_from_file_location("ready_ne_extractor", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load extractor: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--downloads", type=Path, default=Path("/Users/kosangbum/Downloads"))
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    extractor = load_extractor(root / "tools" / "ready-extract-ne-minbyeongcheon.py")
    bundle = json.loads(args.input.read_text())
    drops = [
        question for question in bundle.get("questions", [])
        if question.get("type") == "multiple_choice"
        and question.get("payload", {}).get("import_status") == "drop"
    ]

    by_file: dict[str, list[dict]] = {}
    for question in drops:
        source_file = question.get("payload", {}).get("source", {}).get("source_file")
        if not source_file:
            raise ValueError("objective DROP is missing source_file provenance")
        by_file.setdefault(source_file, []).append(question)

    attached = 0
    for source_file, questions in by_file.items():
        pdf_path = args.downloads / source_file
        if not pdf_path.exists():
            raise FileNotFoundError(pdf_path)
        problem_text, _spans = extractor.problem_pages(pdf_path)
        positions = extractor.question_positions(problem_text)
        blocks = {}
        for order, (number, start, content_start) in enumerate(positions):
            end = positions[order + 1][1] if order < 19 else len(problem_text)
            prompt, body = extractor.prompt_and_body(number, problem_text[content_start:end])
            blocks[number] = extractor.compact(
                f"{problem_text[start:content_start]} {prompt} {body}"
            )

        for question in questions:
            payload = question["payload"]
            number = int(payload["source"]["source_question_no"])
            raw_block = blocks.get(number)
            if not raw_block:
                raise ValueError(f"{source_file} question {number}: raw PDF block missing")
            # set_text is retained as separate legacy evidence because shared
            # worksheet passages often begin before the numbered question.
            payload["_raw_question_text"] = extractor.compact(
                f"SHARED PASSAGE CANDIDATE: {payload.get('set_text', '')} "
                f"CURRENT QUESTION BLOCK: {raw_block}"
            )
            attached += 1

    bundle["objective_fallback_evidence"] = {
        "private": True,
        "attached": attached,
        "scope": "deterministic_drops_only",
    }
    args.output.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"attached": attached, "files": len(by_file)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
