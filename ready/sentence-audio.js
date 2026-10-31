// Step-1 sentence audio. READY had no audio or TTS code before this module,
// so it uses the device's built-in Web Speech API: no server call, no API
// key, and no stored audio. When the browser or WebView has no English
// speech support, the audio button is simply not shown.

export function sentenceAudioSupported(win = globalThis) {
  return Boolean(win?.speechSynthesis && typeof win.SpeechSynthesisUtterance === 'function');
}

export function pickEnglishVoice(voices = []) {
  const list = Array.isArray(voices) ? voices : [];
  const lang = voice => String(voice?.lang || '').replace('_', '-').toLowerCase();
  return list.find(voice => lang(voice) === 'en-us' && voice.localService) || list.find(voice => lang(voice) === 'en-us') || list.find(voice => lang(voice).startsWith('en')) || null;
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
