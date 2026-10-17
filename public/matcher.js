// Word-by-word comparison between what the user typed and the caption text.

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];
const ALIASES = new Map([
  ['ok', 'okay'],
  ['mr', 'mister'],
  ['mrs', 'missus'],
  ['dr', 'doctor'],
  ['percent', '%'],
  ...NUMBER_WORDS.map((w, i) => [String(i), w]),
]);

export function normalize(word) {
  return word
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[^a-z0-9'%]/g, '')
    .replace(/^'+|'+$/g, '');
}

function canonical(n) {
  return ALIASES.get(n) || n;
}

export function wordsEqual(a, b) {
  return a === b || canonical(a) === canonical(b);
}

// Non-speech tokens such as "[Music]", "(applause)", "-", "♪" are shown, not tested.
function isSoundTag(raw) {
  return /^[[(].*[\])]$/.test(raw);
}

/**
 * Split a caption into display tokens.
 * Each token: { raw, norm, checkable }
 */
export function tokenize(text) {
  const tokens = [];
  let inTag = false;
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    if (raw.startsWith('[') || raw.startsWith('(')) inTag = true;
    const tagged = inTag || isSoundTag(raw);
    if (raw.endsWith(']') || raw.endsWith(')')) inTag = false;
    const norm = normalize(raw);
    tokens.push({ raw, norm, checkable: !tagged && norm.length > 0 });
  }
  return tokens;
}

export function typedWords(input) {
  return input.split(/\s+/).filter(Boolean).map(normalize).filter(Boolean);
}

/**
 * Compare typed input against tokens.
 * Returns per-token state: 'static' | 'correct' | 'wrong' | 'typing' | 'pending'
 * plus the user's word at that position (for showing wrong attempts).
 */
export function compare(tokens, input) {
  const typed = input.split(/\s+/).filter(Boolean).filter((w) => normalize(w));
  const stillTyping = input.length > 0 && !/\s$/.test(input);
  let k = 0;
  const states = tokens.map((t) => {
    if (!t.checkable) return { state: 'static' };
    const userRaw = typed[k];
    const isLast = k === typed.length - 1;
    k++;
    if (userRaw === undefined) return { state: 'pending' };
    const u = normalize(userRaw);
    if (wordsEqual(u, t.norm)) return { state: 'correct', user: userRaw };
    if (isLast && stillTyping && t.norm.startsWith(u)) return { state: 'typing', user: userRaw };
    return { state: 'wrong', user: userRaw };
  });
  const complete = states.every((s) => s.state === 'static' || s.state === 'correct');
  return { states, complete };
}

/**
 * Compare a typed word to the target letter by letter (same position).
 * Returns [{ ch, state }] where state is 'ok' (shows the letter), 'bad' (wrong letter),
 * 'pending' (not typed yet) or 'extra' (typed past the end of the word).
 * e.g. target "hello", typed "hallo" -> h ✓, * ✗, l ✓, l ✓, o ✓
 */
export function charDiff(token, userWord) {
  const target = [...token.raw.replace(/[^\p{L}\p{N}']/gu, '')];
  const typed = [...userWord.toLowerCase().replace(/[‘’ʼ`]/g, "'").replace(/[^\p{L}\p{N}']/gu, '')];
  const out = target.map((ch, i) => {
    if (i >= typed.length) return { ch: '*', state: 'pending' };
    return typed[i] === ch.toLowerCase() ? { ch, state: 'ok' } : { ch: '*', state: 'bad' };
  });
  for (let i = target.length; i < typed.length; i++) out.push({ ch: '*', state: 'extra' });
  return out;
}

/** Mask a word for the given difficulty. */
export function mask(token, level) {
  if (!token.checkable) return token.raw;
  const letters = token.raw.replace(/[^\p{L}\p{N}']/gu, '');
  if (level === 'easy') return letters[0] + '*'.repeat(Math.max(letters.length - 1, 0));
  if (level === 'hard') return '???';
  return '*'.repeat(letters.length || 1);
}
