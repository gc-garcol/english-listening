/* Bookmarklet: runs on youtube.com in the user's own browser, so caption requests are
   same-origin (no CORS) and come from the user's IP (no "not a bot" block on servers).
   Captions come from the watch page's own player data, so the innertube API is only a fallback.
   It sends the caption XML to the app in the URL hash: #yt=<base64url(gzip(json))>.
   The app inlines this file into a javascript: link, filling in APP with its own URL.
   Use block comments only: some browsers strip newlines from bookmark URLs. */
(async () => {
  const APP = '__APP__';
  const videoId =
    new URL(location.href).searchParams.get('v') || (location.pathname.match(/\/shorts\/([\w-]{11})/) || [])[1];
  if (!videoId || !/youtube\.com$/.test(location.hostname)) {
    alert('English Listening: open a YouTube video first, then click this bookmark.');
    return;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mp = document.getElementById('movie_player');

  /* 1. The watch page already has the player response (no extra request, never bot-checked). */
  let player = null;
  try {
    const pr = mp && mp.getPlayerResponse && mp.getPlayerResponse();
    if (pr && pr.videoDetails && pr.videoDetails.videoId === videoId) player = pr;
  } catch (e) {}
  const initial = window.ytInitialPlayerResponse;
  if (!player && initial && initial.videoDetails && initial.videoDetails.videoId === videoId) player = initial;

  /* 2. Fallback: the innertube API as a mobile client (can hit "Sign in to confirm you're not a bot"). */
  const clients = [
    { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en' },
    {
      clientName: 'IOS',
      clientVersion: '20.10.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.3.2.22D82',
      hl: 'en',
    },
  ];
  for (const client of player ? [] : clients) {
    const res = await fetch('/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client }, videoId }),
    });
    const json = await res.json();
    if (json.captions) {
      player = json;
      break;
    }
  }

  const tracks = (player && player.captions && player.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
  const english = tracks.filter((t) => t.languageCode.startsWith('en'));
  const track = english.find((t) => t.kind !== 'asr') || english[0];
  if (!track) {
    alert(
      player
        ? 'English Listening: this video has no English captions.'
        : 'English Listening: YouTube did not return captions. Reload the video page (F5) and click the bookmark again.',
    );
    return;
  }

  const base = track.baseUrl.replace(/&fmt=[^&]*/, '');
  const download = async (url) => {
    const text = await (await fetch(url)).text();
    return /<text[\s>]/.test(text) ? text : '';
  };
  let xml = await download(base);

  /* 3. Web caption URLs now need a "pot" token, which only YouTube's own player creates when it
     loads captions. Turn captions on, read the token from the player's request, then reuse it. */
  if (!xml && mp) {
    const findPot = () => {
      const entries = performance.getEntriesByType('resource');
      for (let i = entries.length - 1; i >= 0; i--) {
        if (!entries[i].name.includes('/api/timedtext')) continue;
        const u = new URL(entries[i].name);
        if (u.searchParams.get('v') === videoId && u.searchParams.get('pot')) return u.searchParams.get('pot');
      }
      return null;
    };
    let pot = findPot();
    if (!pot) {
      performance.setResourceTimingBufferSize(1000);
      try {
        mp.unloadModule('captions');
        mp.loadModule('captions');
        mp.setOption('captions', 'track', { languageCode: track.languageCode });
      } catch (e) {}
      for (let i = 0; i < 40 && !pot; i++) {
        await sleep(250);
        pot = findPot();
      }
      try {
        mp.unloadModule('captions');
      } catch (e) {}
    }
    if (pot) xml = await download(base + '&pot=' + encodeURIComponent(pot) + '&c=WEB');
  }
  if (!xml) {
    alert('English Listening: could not download the captions. Press play, turn on CC once, then click the bookmark again.');
    return;
  }

  const payload = JSON.stringify({
    videoId,
    title: (player.videoDetails && player.videoDetails.title) || document.title,
    language: track.languageCode,
    xml,
  });
  const gz = await new Response(new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  let bin = '';
  new Uint8Array(gz).forEach((b) => (bin += String.fromCharCode(b)));
  const data = btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

  const url = APP + '?v=' + videoId + '#yt=' + data;
  /* window.open can be blocked once the click's user activation has expired; navigate instead. */
  if (!window.open(url, '_blank')) location.href = url;
})().catch((e) => alert('English Listening: ' + e.message));
