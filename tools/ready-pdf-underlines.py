#!/usr/bin/env python3
"""Extract publisher underline spans from PDF geometry, grouped by page and question number."""
import argparse
import json
import re
import pdfplumber

parser = argparse.ArgumentParser()
parser.add_argument("pdf")
args = parser.parse_args()

result = {}
with pdfplumber.open(args.pdf) as pdf:
    for page_number, page in enumerate(pdf.pages, 1):
        words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
        headers = [word for word in words if re.fullmatch(r"\d+\.", word["text"])]
        if not headers:
            continue
        rules = [rect for rect in page.rects if rect["height"] <= 1.5 and 2 <= rect["width"] <= 180]
        spans = []
        for rule in rules:
            hits = [word for word in words
                    if min(word["x1"], rule["x1"]) - max(word["x0"], rule["x0"]) > max(1, .45 * word["width"])
                    and -1 <= rule["top"] - word["bottom"] <= 2.5]
            if hits:
                spans.append({"text": " ".join(word["text"] for word in sorted(hits, key=lambda item: item["x0"])),
                              "x0": rule["x0"], "top": rule["top"]})
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
                result[f"{page_number}:{question}"] = selected

print(json.dumps(result, ensure_ascii=False))
