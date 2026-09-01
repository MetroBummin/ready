export function normalizeWorkbookAnswer(value) {
  return String(value ?? '').trim().normalize('NFKC').toLowerCase()
    .replace(/[“”‘’'".,!?;:()[\]{}]/g, '')
    .replace(/\s+/g, ' ').trim();
}

export function workbookRecallCue(value, mode) {
  const text = String(value ?? '').trim().normalize('NFKC');
  if (mode === 'korean_syllable') return text.match(/[가-힣]/u)?.[0] || '';
  return text.match(/[A-Za-z]/)?.[0]?.toLowerCase() || '';
}

export function workbookAssistanceMode(item) {
  if (Number(item.stage) === 2) return { mode: 'recall_local', recallMode: 'korean_syllable' };
  if (Number(item.stage) === 3) return { mode: 'recall_local', recallMode: 'english_initial' };
  if (Number(item.stage) === 9) return { mode: 'prefix_typing' };
  return null;
}

export async function publicWorkbookAssistance(item, sha256Hex, cryptoImpl = globalThis.crypto) {
  const modeContract = workbookAssistanceMode(item);
  if (!modeContract) return null;
  if (Number(item.stage) === 2 || Number(item.stage) === 3) {
    const mode = modeContract.recallMode;
    const slots = await Promise.all(item.answers.map(async answer => {
      const salt = cryptoImpl.randomUUID();
      const cue = workbookRecallCue(answer, mode);
      return { salt, hash: await sha256Hex(`${salt}:${cue}`) };
    }));
    return { mode: 'recall_unlock', recallMode: mode, slots };
  }
  const slots = await Promise.all(item.answers.map(async answer => {
    const normalized = normalizeWorkbookAnswer(answer), salt = cryptoImpl.randomUUID(), prefixHashes = [];
    for (let length = 1; length <= normalized.length; length += 1) prefixHashes.push(await sha256Hex(`${salt}:${normalized.slice(0, length)}`));
    return { salt, normalizedLength: normalized.length, prefixHashes };
  }));
  return { mode: 'prefix_typing', slots };
}

export function stageNineHint(answer, level) {
  const text = String(answer ?? '').trim();
  if (Number(level) >= 2) return text;
  const words = text.split(/\s+/).filter(Boolean);
  return words.length > 1 ? words[0] : (workbookRecallCue(text, 'english_initial') || text.slice(0, 1));
}
