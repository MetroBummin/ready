#!/usr/bin/env python3
"""Extract publisher underline spans from PDF geometry, grouped by page and question number."""
import argparse
import json
import re

parser = argparse.ArgumentParser()
parser.add_argument("pdf", nargs="?")
parser.add_argument("--self-test", action="store_true")
args = parser.parse_args()

def horizontal_rules(page):
    """Return thin horizontal publisher rules without treating table borders as underlines."""
    candidates = [*page.lines, *page.rects]
    seen = set()
    for shape in candidates:
        x0, x1 = sorted((shape["x0"], shape["x1"]))
        top, bottom = sorted((shape["top"], shape["bottom"]))
        width, height = x1 - x0, bottom - top
        if height > 1.5 or not 2 <= width <= 240:
            continue
        key = (round(x0, 2), round(x1, 2), round(top, 2))
        if key in seen:
            continue
        seen.add(key)
        yield {"x0": x0, "x1": x1, "top": top, "width": width}


def underlined_text(page, rule):
    """Map a rule to the exact glyphs it overlaps, excluding adjacent labels and words."""
    hits = []
    for char in page.chars:
        width = max(char["x1"] - char["x0"], 0.01)
        overlap = min(char["x1"], rule["x1"]) - max(char["x0"], rule["x0"])
        if overlap <= max(0.15, 0.42 * width):
            continue
        if not -1 <= rule["top"] - char["bottom"] <= 2.5:
            continue
        hits.append(char)
    if not hits:
        return ""
    hits.sort(key=lambda item: item["x0"])
    output = []
    previous = None
    for char in hits:
        if previous is not None:
            gap = char["x0"] - previous["x1"]
            if gap > 1.5 * char["height"]:
                return ""
            if gap > max(0.8, 0.18 * char["height"]):
                output.append(" ")
        output.append(char["text"])
        previous = char
    return re.sub(r"\s+", " ", "".join(output)).strip()


if args.self_test:
    def glyphs(value, x0=10, top=10, height=9):
        output = []
        cursor = x0
        for char in value:
            width = 3 if char != " " else 2
            if char != " ":
                output.append({"text": char, "x0": cursor, "x1": cursor + width, "top": top,
                               "bottom": top + height, "height": height})
            cursor += width
        return output

    class FixturePage:
        chars = glyphs("ⓒchange certain people's behavior")

    fixture = FixturePage()
    assert underlined_text(fixture, {"x0": 13, "x1": 31, "top": 19}) == "change"
    fixture.chars = glyphs("ⓑbeing surveyed more")
    assert underlined_text(fixture, {"x0": 13, "x1": 55, "top": 19}) == "being surveyed"
    print("READY PDF underline glyph intersection verified.")
    raise SystemExit(0)

if not args.pdf:
    parser.error("pdf is required unless --self-test is used")

import pdfplumber

result = {}
with pdfplumber.open(args.pdf) as pdf:
    for page_number, page in enumerate(pdf.pages, 1):
        words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
        headers = [word for word in words if re.fullmatch(r"\d+\.", word["text"])]
        if not headers:
            continue
        spans = []
        for rule in horizontal_rules(page):
            value = underlined_text(page, rule)
            if value:
                spans.append({"text": value, "x0": rule["x0"], "x1": rule["x1"], "top": rule["top"],
                              "evidence": "publisher underline geometry intersecting PDF glyphs"})
        if spans:
            result[f"page:{page_number}"] = sorted(spans, key=lambda item: (item["top"], item["x0"]))
        for header in headers:
            question = int(header["text"][:-1])
            column = 0 if header["x0"] < page.width / 2 else 1
            next_tops = [other["top"] for other in headers
                         if (0 if other["x0"] < page.width / 2 else 1) == column and other["top"] > header["top"]]
            bottom = min(next_tops) if next_tops else page.height
            selected = [span for span in spans
                        if (0 if span["x0"] < page.width / 2 else 1) == column
                        and header["top"] <= span["top"] < bottom]
            if selected:
                result[f"{page_number}:{question}"] = sorted(selected, key=lambda item: (item["top"], item["x0"]))

print(json.dumps(result, ensure_ascii=False))
