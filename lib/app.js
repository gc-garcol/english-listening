import express from 'express';
import { extractVideoId, fetchTranscript } from './youtube.js';

// API routes shared by the Node server (server.js) and the Cloudflare Worker (worker.js).
export function createApp() {
  const app = express();

  // Small in-memory cache so reloading a video doesn't hit YouTube again.
  const cache = new Map();

  app.get('/api/transcript', async (req, res) => {
    const videoId = extractVideoId(String(req.query.url || ''));
    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL.' });

    const lang = String(req.query.lang || 'en');
    const key = `${videoId}:${lang}`;
    try {
      if (!cache.has(key)) cache.set(key, await fetchTranscript(videoId, lang));
      res.json(cache.get(key));
    } catch (err) {
      console.error(`[transcript] ${videoId}:`, err.message);
      res.status(502).json({ error: err.message, videoId });
    }
  });

  return app;
}
