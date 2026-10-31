// Step-1 sentence audio. READY had no audio or TTS code before this module,
// so it uses the device's built-in Web Speech API: no server call, no API
// key, and no stored audio. When the browser or WebView has no English
// speech support, the audio button is simply not shown.

export function sentenceAudioSupported(win = globalThis) {
  return Boolean(win?.speechSynthesis && typeof win.SpeechSynthesisUtterance === 'function');
}

// Apple platforms list novelty voices (Albert, Bad News, Zarvox, ...) as
// local en-US voices, often first in alphabetical order. They are never picked.
const NOVELTY_VOICES = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior|kathy|organ|pipe organ|princess|ralph|superstar|trinoids|whisper|wobble|zarvox|fred)\b/i;
const PREFERRED_VOICES = /\b(samantha|alex|ava|allison|susan|google us english|aria|jenny|guy|zira|david)\b/i;

export function pickEnglishVoice(voices = []) {
  const lang = voice => String(voice?.lang || '').replace('_', '-').toLowerCase();
  const list = (Array.isArray(voices) ? voices : []).filter(voice => lang(voice).startsWith('en') && !NOVELTY_VOICES.test(String(voice?.name || '')));
  const us = list.filter(voice => lang(voice) === 'en-us');
  return us.find(voice => voice.default) || us.find(voice => PREFERRED_VOICES.test(String(voice.name || '')) && voice.localService)
    || us.find(voice => PREFERRED_VOICES.test(String(voice.name || ''))) || us.find(voice => voice.localService) || us[0]
    || list.find(voice => voice.default) || list[0] || null;
}

export function speakSentence(text, { win = globalThis, rate = 0.9 } = {}) {
  const value = String(text ?? '').trim();
  if (!value || !sentenceAudioSupported(win)) return false;
  const synth = win.speechSynthesis, utterance = new win.SpeechSynthesisUtterance(value);
  utterance.lang = 'en-US';
  utterance.rate = rate;
  const voice = pickEnglishVoice(typeof synth.getVoices === 'function' ? synth.getVoices() : []);
  if (voice) utterance.voice = voice;
  synth.cancel();
  synth.speak(utterance);
  return true;
}

export function stopSentenceAudio(win = globalThis) {
  if (sentenceAudioSupported(win)) win.speechSynthesis.cancel();
}
