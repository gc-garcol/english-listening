// Parsers for manually pasted transcripts + segment merging.

function toSeconds(ts) {
  const parts = ts.replace(',', '.').split(':').map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** SRT or WebVTT: blocks with "start --> end" lines. */
function parseCues(text) {
  const segments = [];
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  const timeRe = /((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;
  for (const block of blocks) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => timeRe.test(l));
    if (i === -1) continue;
    const [, a, b] = lines[i].match(timeRe);
    const body = lines
      .slice(i + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (body) segments.push({ start: toSeconds(a), end: toSeconds(b), text: body });
  }
  return segments;
}

/** Text copied from YouTube's "Show transcript" panel: "0:12" on one line, text after. */
function parseYoutubePanel(text) {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const tsRe = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;
  const segments = [];
  for (let i = 0; i < lines.length; i++) {
    if (!tsRe.test(lines[i])) continue;
    const start = toSeconds(lines[i]);
    const texts = [];
    while (i + 1 < lines.length && !tsRe.test(lines[i + 1])) texts.push(lines[++i]);
    // The panel sometimes adds "N seconds" accessibility lines; drop them.
    const body = texts.filter((t) => !/^\d+ (?:seconds?|minutes?)/.test(t)).join(' ');
    if (body) segments.push({ start, text: body });
  }
  for (let i = 0; i < segments.length; i++) {
    segments[i].end = segments[i + 1]?.start ?? segments[i].start + 5;
  }
  return segments;
}

/** YouTube caption XML: <text start="1.2" dur="3.4">…</text> (seconds). */
export function parseCaptionXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const decoder = document.createElement('textarea');
  const segments = [];
  for (const el of doc.querySelectorAll('text')) {
    decoder.innerHTML = el.textContent; // entities are often double-encoded (&amp;#39;)
    const text = decoder.value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const start = parseFloat(el.getAttribute('start'));
    segments.push({ start, end: start + parseFloat(el.getAttribute('dur') || '0'), text });
  }
  // Captions often overlap; clamp each end to the next start.
  for (let i = 0; i < segments.length - 1; i++) {
    segments[i].end = Math.min(segments[i].end, segments[i + 1].start) || segments[i + 1].start;
  }
  return segments;
}

/** Transcript sent by the bookmarklet in the URL hash: #yt=<base64url(gzip(json))>. */
export async function readHashImport(hash) {
  const m = hash.match(/^#yt=([\w-]+)$/);
  if (!m) return null;
  const bin = Uint8Array.from(atob(m[1].replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
  const json = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const { videoId, title, language, xml } = JSON.parse(json);
  return { videoId, title, language, segments: parseCaptionXml(xml), manual: true };
}

export function parseTranscript(text) {
  const cues = parseCues(text);
  if (cues.length) return cues;
  return parseYoutubePanel(text);
}

/**
 * Merge caption lines into sentence-sized segments.
 * Lines are joined until one ends with . ? ! (or the segment gets too long).
 */
export function mergeSentences(segments, { maxSeconds = 14, maxWords = 30 } = {}) {
  const out = [];
  let cur = null;
  for (const s of segments) {
    if (!cur) cur = { ...s };
    else {
      cur.text += ' ' + s.text;
      cur.end = s.end;
    }
    const words = cur.text.split(/\s+/).length;
    const ended = /[.?!…]["')\]]?$/.test(cur.text);
    if (ended || cur.end - cur.start >= maxSeconds || words >= maxWords) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}
