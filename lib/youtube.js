// Fetches YouTube captions without an API key.
// Strategy (same idea as the python `youtube-transcript-api`):
//   1. Call the innertube `player` endpoint as a mobile client, which returns
//      caption track URLs that don't require a PO token.
//   2. Download the chosen track (XML) and parse it into segments.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';// Innertube clients whose caption URLs work without a PO token, in order of preference.
const CLIENTS = [
  {
    context: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en' },
    userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
  },
  {
    context: {
      clientName: 'IOS',
      clientVersion: '20.10.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.3.2.22D82',
      hl: 'en',
    },
    userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
  },
];

export function extractVideoId(input) {
  if (!input) return null;
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const url = new URL(s);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1, 12) || null;
    if (url.searchParams.get('v')) return url.searchParams.get('v').slice(0, 11);
    const m = url.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/);
    if (m) return m[1];
  } catch {
    /* not a URL */
  }
  return null;
}

async function getPlayerResponse(videoId, client) {
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': client.userAgent },
    body: JSON.stringify({ context: { client: client.context }, videoId }),
  });
  if (!res.ok) throw new Error(`YouTube player request failed (${res.status}).`);
  return res.json();
}

// Try each client until one returns playable captions. YouTube's bot check
// ("Sign in to confirm you're not a bot") is per IP + client, so a second client sometimes passes.
async function getPlayableResponse(videoId) {
  let lastReason = '';
  for (const client of CLIENTS) {
    const player = await getPlayerResponse(videoId, client);
    const status = player?.playabilityStatus?.status;
    if (!status || status === 'OK') return player;
    lastReason = player.playabilityStatus.reason || status;
    console.warn(`[transcript] ${videoId}: ${client.context.clientName} -> ${lastReason}`);
  }
  if (/not a bot|sign in/i.test(lastReason)) {
    throw new Error(
      `YouTube blocked this server's IP ("${lastReason}"). Cloud/datacenter IPs are often blocked — ` +
        'run the app from a home network, or paste a transcript manually.',
    );
  }
  throw new Error(`Video not playable: ${lastReason}`);
}

function pickTrack(tracks, lang) {
  const byLang = (t) => t.languageCode === lang || t.languageCode.startsWith(lang + '-');
  return (
    tracks.find((t) => byLang(t) && t.kind !== 'asr') || // manual captions first
    tracks.find((t) => byLang(t)) || // then auto-generated
    null
  );
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(str) {
  return str.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function parseTranscriptXml(xml) {
  const segments = [];
  const re = /<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(xml))) {
    // Entities are often double-encoded (&amp;#39;), so decode twice, then strip tags.
    const text = decodeEntities(decodeEntities(m[3]))
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const start = parseFloat(m[1]);
    segments.push({ start, end: start + parseFloat(m[2] || '0'), text });
  }
  // Captions often overlap; clamp each end to the next start.
  for (let i = 0; i < segments.length - 1; i++) {
    segments[i].end = Math.min(segments[i].end, segments[i + 1].start) || segments[i + 1].start;
  }
  return segments;
}

export async function fetchTranscript(videoId, lang = 'en') {
  const player = await getPlayableResponse(videoId);

  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) throw new Error('This video has no captions. Paste a transcript manually instead.');

  const track = pickTrack(tracks, lang);
  if (!track) {
    const available = tracks.map((t) => t.languageCode).join(', ');
    throw new Error(`No "${lang}" captions. Available: ${available}`);
  }

  const res = await fetch(track.baseUrl.replace('&fmt=srv3', ''), { headers: { 'User-Agent': UA } });
  const xml = await res.text();
  const segments = parseTranscriptXml(xml);
  if (!segments.length) throw new Error('Caption track was empty.');

  return {
    videoId,
    title: player?.videoDetails?.title || '',
    author: player?.videoDetails?.author || '',
    language: track.languageCode,
    autoGenerated: track.kind === 'asr',
    segments,
  };
}
