// READY Student: HTML for the sentence-practice screen.
//
// Pure functions of a view model, no DOM access, so the layout rules (preview
// gating, long-sentence class, all chips visible) can be tested in Node.
// ready/app.js owns state, events and focus.
import { isLongSentence } from './sentence-practice.js?v=sentence-practice-2';

export const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

const svg = (body, { size = 24, fill = 'none', stroke = 1.7 } = {}) => `<svg class="practice-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON = {
  back: () => svg('<path d="M15 5l-7 7 7 7"/>', { size: 26, stroke: 1.6 }),
  star: filled => svg('<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>', { size: 26, fill: filled ? 'currentColor' : 'none', stroke: 1.5 }),
  sliders: () => svg('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><path d="M15 5v4M9 10v4M17 15v4"/>', { size: 26, stroke: 1.8 }),
  speaker: () => svg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 7a7 7 0 0 1 0 10"/>', { size: 30, stroke: 1.4 }),
  chevrons: () => svg('<path d="M12 6l-6 6 6 6M18 6l-6 6 6 6"/>', { size: 22, stroke: 2 }),
};

export const STEP_LABEL = { 1: '1단계 · 듣고 배열', 2: '2단계 · 혼자 배열' };

function barHtml(view) {
  const { done, total, bookmarked, settingsOpen } = view;
  return `<header class="practice-bar">
<button class="practice-icon-button practice-back" type="button" data-exit-practice data-focus-id="back" aria-label="목록으로">${ICON.back()}</button>
<span class="practice-counter" role="img" aria-label="${total}문장 중 ${done}문장 완료"><b>${done}</b><span class="practice-counter-sep">/</span><b>${total}</b></span>
<span class="practice-bar-actions">
<button class="practice-icon-button practice-star" type="button" data-practice-bookmark data-focus-id="bookmark" aria-pressed="${bookmarked}" aria-label="이 문장 표시">${ICON.star(bookmarked)}</button>
<button class="practice-icon-button" type="button" data-practice-settings data-focus-id="settings" aria-expanded="${settingsOpen}" aria-controls="practice-settings" aria-label="설정">${ICON.sliders()}</button>
</span>
</header>`;
}

function settingsHtml(view) {
  if (!view.settingsOpen) return '';
  const row = (id, label, on) => `<button class="practice-switch" type="button" role="switch" data-practice-setting="${id}" data-focus-id="setting-${id}" aria-checked="${on}"><span>${label}</span><span class="practice-switch-track" aria-hidden="true"><span></span></span></button>`;
  return `<div class="practice-settings" id="practice-settings" role="group" aria-label="연습 설정">${row('theme', '다크 모드', view.dark)}${view.audio ? row('autoplay', '자동 재생', view.autoplay) : ''}</div>`;
}

function toolsHtml(view) {
  const speaker = view.audio ? `<button class="practice-icon-button practice-speaker" type="button" data-play-audio data-focus-id="audio" aria-label="영어 문장 듣기">${ICON.speaker()}</button>` : '';
  const rule = view.step === 2 ? ` · ${view.allowance ? '한 번 틀려도 됨' : '틀리면 다시 시작'}` : '';
  return `<div class="practice-tools">${speaker}<span class="practice-step">${esc(STEP_LABEL[view.step])}${rule}</span></div>`;
}

// ref1: the English sentence with the Korean hidden behind a tap-to-reveal bar.
function previewHtml(view) {
  const { item, revealed } = view;
  const korean = revealed
    ? `<p class="practice-preview-ko" lang="ko" data-focus-id="reveal" tabindex="-1">${esc(item.translation)}</p>`
    : '<button class="practice-reveal" type="button" data-practice-reveal data-focus-id="reveal" aria-label="한국어 뜻 보기"></button>';
  return `<div class="practice-head">${barHtml(view)}${toolsHtml(view)}</div>
<div class="practice-preview" data-practice-swipe><p class="practice-preview-en" lang="en">${esc(item.text)}</p>${korean}</div>
<div class="practice-foot"><button class="practice-begin" type="button" data-practice-begin data-focus-id="begin">${ICON.chevrons()}<span>밀어서 영작연습</span></button></div>`;
}

const FEEDBACK = {
  1: { mistake: '그 단어는 아직 아니에요. 계속 골라 보세요.' },
  2: { mistake: '한 번 틀렸어요. 한 번 더 틀리면 처음부터 다시 시작해요.', restart: '틀렸어요. 처음부터 다시 배열하세요.' },
};

function feedbackHtml(view) {
  const { run, feedback, step, clean } = view;
  if (run.completed) {
    const detail = clean ? '' : ` · ${step === 1 ? `틀린 선택 ${run.mistakes}번` : `다시 시작 ${run.restarts}번`}`;
    return `<p class="practice-feedback is-correct"><span aria-hidden="true">✓</span> ${clean ? '완성했어요.' : '끝까지 완성했어요.'}${detail}</p>`;
  }
  const message = feedback ? FEEDBACK[step]?.[feedback.type] : '';
  return message ? `<p class="practice-feedback is-wrong">${esc(message)}</p>` : '<p class="practice-feedback" aria-hidden="true"></p>';
}

// ref2: Korean prompt, the answer growing on ruled lines, every unplaced chip.
function orderHtml(view) {
  const { item, run, chips, wrongChip, built, isLast } = view;
  // A finished sentence is shown as the canonical text, punctuation included.
  const answer = run.completed ? `<span lang="en">${esc(item.text)}</span>` : built ? `<span lang="en">${esc(built)}</span>` : '<span class="sr-only">단어를 순서대로 누르세요</span>';
  const bank = run.completed ? '' : `<div class="practice-bank" role="group" aria-label="선택할 단어">${chips.map(chip => `<button class="practice-chip${wrongChip === chip ? ' wrong' : ''}" type="button" lang="en" data-chip="${chip}" aria-invalid="${wrongChip === chip}">${esc(item.words[chip])}</button>`).join('')}</div>`;
  const next = run.completed ? `<div class="practice-foot"><button class="button primary practice-next" type="button" data-practice-next data-focus-id="next">${isLast ? '결과 보기' : '다음 문장'}</button></div>` : '';
  return `<div class="practice-head">${barHtml(view)}${toolsHtml(view)}<p class="practice-ko" lang="ko">${esc(item.translation)}</p><div class="practice-answer" role="group" aria-label="배열한 문장">${answer}</div>${feedbackHtml(view)}</div>${bank}${next}`;
}

// view: { step, phase: 'preview' | 'order', item, run, chips, wrongChip,
//   feedback, built, clean, done, total, isLast, revealed, audio, bookmarked,
//   settingsOpen, autoplay, dark }
export function practiceScreenHtml(view) {
  const long = isLongSentence(view.item.words.length);
  const classes = ['practice-screen', `is-${view.phase}`, long ? 'is-long' : '', view.run?.completed ? 'is-complete' : ''].filter(Boolean).join(' ');
  return `<div class="${classes}" data-practice-item="${esc(view.item.key)}" data-practice-phase="${view.phase}" data-practice-step="${view.step}">${view.phase === 'preview' ? previewHtml(view) : orderHtml(view)}${settingsHtml(view)}</div>`;
}

export function feedbackSpeech(step, type) { return FEEDBACK[step]?.[type] || ''; }
