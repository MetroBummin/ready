import { sourceContractErrors } from "./source-contract.mjs";
import { interactionContractErrors, publisherRoundTripErrors } from "./interaction-contract.mjs";
import { questionRepresentationPayloadErrors } from "./question-representation.mjs";

// AI-authored Questions must first follow ready/QUESTION_AUTHORING.md and pass
// question-authoring-quality.mjs or question-reference-bank.mjs against the
// canonical passage. This renderer validation is necessary but cannot by
// itself prove source fidelity.

export const READY_RENDERERS = Object.freeze([
  "standard_mcq",
  "annotated_passage_mcq",
  "structural",
  "summary",
  "written_input",
]);

export const READY_TAXONOMY = Object.freeze([
  "topic", "title", "main_idea", "purpose", "emotion",
  "content_true", "content_false", "unanswerable",
  "grammar_single_error", "grammar_multi_error", "grammar_ab",
  "vocabulary_context", "vocabulary_ab",
  "blank_word", "blank_phrase", "blank_sentence",
  "sentence_insertion", "irrelevant_sentence", "paragraph_order",
  "implication", "summary_two_blank", "summary_completion",
  "arrangement", "translation", "guided_writing", "correction", "reference",
]);

const rendererSet = new Set(READY_RENDERERS);
const taxonomySet = new Set(READY_TAXONOMY);
const importStatusSet = new Set(["ready", "drop"]);
const responseModeSet = new Set(["choice", "input"]);
const choiceModeSet = new Set(["single", "multi", "none"]);
const gradingModeSet = new Set(["exact", "exact_set", "normalized", "accepted_variants", "ai"]);
const passageSourceSet = new Set(["canonical", "authored_variant", "segments", "blocks"]);
const extraSet = new Set(["stimulus", "summary"]);

function text(value) { return typeof value === "string" ? value.trim() : ""; }
function list(value) { return Array.isArray(value) ? value : []; }

export function legacyTaxonomy(payload = {}, type = "multiple_choice") {
  const prompt = text(payload.prompt), skill = text(payload.skill);
  if (type === "written_response") {
    if (/배열/.test(prompt)) return "arrangement";
    if (/고쳐/.test(prompt)) return "correction";
    if (/해석/.test(prompt)) return "translation";
    if (/요약/.test(prompt)) return "summary_completion";
    return "guided_writing";
  }
  if (/일치하지 않|불일치/.test(prompt)) return "content_false";
  if (/일치/.test(prompt)) return "content_true";
  if (/답할 수 없/.test(prompt)) return "unanswerable";
  if (/어법/.test(prompt)) return payload.multi_select === true ? "grammar_multi_error" : "grammar_single_error";
  if (/가리키는 대상|지칭/.test(prompt)) return "reference";
  if (/어휘|문맥상|흐름상/.test(prompt) || skill === "vocabulary") return "vocabulary_context";
  if (/삽입/.test(prompt) || skill === "insertion") return "sentence_insertion";
  if (/무관/.test(prompt)) return "irrelevant_sentence";
  if (/순서/.test(prompt) || skill === "order") return "paragraph_order";
  if (/요약/.test(prompt) || skill === "summary") return "summary_two_blank";
  if (/빈칸/.test(prompt) || skill === "blank") return "blank_phrase";
  if (/함축|의미/.test(prompt) || skill === "implication") return "implication";
  if (/제목/.test(prompt) || skill === "title") return "title";
  if (/주제/.test(prompt) || skill === "topic") return "topic";
  if (/요지/.test(prompt)) return "main_idea";
  if (/목적/.test(prompt)) return "purpose";
  if (/심경/.test(prompt)) return "emotion";
  return "content_true";
}

export function legacyRenderer(payload = {}, type = "multiple_choice") {
  if (type === "written_response") return "written_input";
  const family = text(payload.family);
  return ({ standard: "standard_mcq", annotated: "annotated_passage_mcq", structural: "structural", summary: "summary" })[family] || "standard_mcq";
}

export function legacyQuestionSpec(payload = {}, type = "multiple_choice", rowStatus = "available") {
  const renderer = legacyRenderer(payload, type), taxonomy = legacyTaxonomy(payload, type);
  const annotations = [
    ...list(payload.target_ranges).map(item => ({ kind: "target", label: text(item?.label), text: text(item?.text), canonicalText: text(item?.canonical_text) || text(item?.text) })),
    ...list(payload.variant_segments).filter(item => item && item.kind !== "text").map(item => ({ kind: text(item.kind), label: text(item.label), text: text(item.text) })),
  ].filter(item => item.label || item.text);
  const source = list(payload.content_blocks).length ? "blocks" : list(payload.variant_segments).length ? "segments" : payload.variant_mode === "authored_variant" ? "authored_variant" : "canonical";
  return {
    version: 1,
    taxonomy,
    renderer,
    importStatus: rowStatus === "available" ? "ready" : "drop",
    passage: { source, annotations, deviceMode: taxonomy.startsWith("blank_") ? "blank" : taxonomy === "sentence_insertion" ? "structural" : annotations.length ? "annotations" : "plain" },
    blocks: list(payload.content_blocks),
    extras: [payload.stimulus ? "stimulus" : "", payload.summary_text ? "summary" : ""].filter(Boolean),
    choiceMode: type === "multiple_choice" ? (payload.multi_select === true ? "multi" : "single") : "none",
    responseMode: type === "written_response" ? "input" : "choice",
    gradingMode: type === "written_response" ? "accepted_variants" : payload.multi_select === true ? "exact_set" : "exact",
    legacyAdapter: true,
  };
}

export function normalizeQuestionSpec(payload = {}, type = "multiple_choice", rowStatus = "available") {
  const raw = payload.spec && typeof payload.spec === "object" ? payload.spec : null;
  if (!raw) return legacyQuestionSpec(payload, type, rowStatus);
  return {
    version: 1,
    taxonomy: text(payload.taxonomy) || text(raw.taxonomy),
    renderer: text(raw.renderer),
    importStatus: text(payload.import_status) || text(raw.importStatus) || "drop",
    passage: {
      source: text(raw.passage?.source),
      annotations: list(raw.passage?.annotations),
      deviceMode: text(raw.passage?.deviceMode) || "plain",
    },
    blocks: list(raw.blocks),
    extras: list(raw.extras).map(text).filter(item => extraSet.has(item)),
    choiceMode: text(raw.choiceMode),
    responseMode: text(raw.responseMode),
    gradingMode: text(raw.gradingMode),
    legacyAdapter: false,
  };
}

export function questionSpecErrors(spec, payload = {}, type = "multiple_choice") {
  const errors = [];
  if (!taxonomySet.has(spec?.taxonomy)) errors.push("unknown taxonomy");
  if (!rendererSet.has(spec?.renderer)) errors.push("unknown renderer");
  if (!importStatusSet.has(spec?.importStatus)) errors.push("unknown import status");
  if (!passageSourceSet.has(spec?.passage?.source)) errors.push("unknown passage source");
  if (!choiceModeSet.has(spec?.choiceMode)) errors.push("unknown choice mode");
  if (!responseModeSet.has(spec?.responseMode)) errors.push("unknown response mode");
  if (!gradingModeSet.has(spec?.gradingMode)) errors.push("unknown grading mode");
  for (const extra of list(spec?.extras)) if (!extraSet.has(extra)) errors.push(`unknown extra ${extra}`);
  if (type === "multiple_choice" && spec?.responseMode !== "choice") errors.push("multiple choice requires choice response");
  if (type === "written_response" && spec?.responseMode !== "input") errors.push("written response requires input response");
  if (type === "written_response") {
    const guide = payload.writing_guide && typeof payload.writing_guide === "object" ? payload.writing_guide : null;
    const accepted = list(payload.accepted_answers), slots = list(payload.response_slots);
    if (!guide) errors.push("written response guide is missing");
    if (!accepted.length || slots.length !== accepted.length) errors.push("written response slot contract is incomplete");
    const kind = text(guide?.kind), targets = list(guide?.targets);
    if (/correction/.test(kind) && !targets.length) errors.push("written correction targets are missing");
    if (["sentence", "sentence_cloze", "sentence-cloze", "arrangement"].includes(kind) && /우리말/.test(text(payload.prompt)) && !text(guide?.task_text)) errors.push("written Korean target is missing");
    for (const [index, slot] of slots.entries()) {
      const variants = Array.isArray(accepted[index]) ? accepted[index] : [accepted[index]];
      const counts = new Set(variants.map(value => (text(value).match(/[A-Za-z]+(?:['’][A-Za-z]+)?|[가-힣]+|\d+(?:,\d{3})*(?:\.\d+)?/g) || []).length));
      if (!variants.length || counts.has(0)) errors.push(`written slot ${index + 1} has no lexical publisher answer`);
      if (!Number.isInteger(Number(slot?.word_count)) || Number(slot?.word_count) < 1 || !counts.has(Number(slot.word_count))) errors.push(`written slot ${index + 1} word count mismatch`);
    }
  }
  if (spec?.passage?.source === "authored_variant" && !text(payload.variant_text || payload.set_text)) errors.push("authored variant text is missing");
  if (spec?.passage?.source === "segments" && !list(payload.variant_segments).length) errors.push("variant segments are missing");
  if (spec?.passage?.source === "blocks" && !list(payload.content_blocks).length && !list(spec.blocks).length) errors.push("content blocks are missing");
  for (const [index, annotation] of list(spec?.passage?.annotations).entries()) {
    if (!annotation || !text(annotation.kind) || (!text(annotation.text) && !text(annotation.label))) errors.push(`annotation ${index + 1} is incomplete`);
  }
  if (Number(payload?.pipeline_contract?.version) === 2) errors.push(...sourceContractErrors(payload, spec));
  if (payload?.representation) errors.push(...questionRepresentationPayloadErrors(payload));
  errors.push(...interactionContractErrors(payload, type));
  if (spec?.importStatus === "ready") errors.push(...publisherRoundTripErrors(payload, type));
  return errors;
}

export function validateQuestionSpec(payload = {}, type = "multiple_choice", rowStatus = "available") {
  const spec = normalizeQuestionSpec(payload, type, rowStatus);
  const errors = questionSpecErrors(spec, payload, type);
  if (type === "written_response" && (payload?.ai_structure?.engine !== "codex-cli" || Number(payload?.ai_structure?.contract_version) !== 2)) errors.push("written response did not pass the block-first AI structure contract");
  return { spec, errors, ready: spec.importStatus === "ready" && errors.length === 0 };
}
