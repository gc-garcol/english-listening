import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './lib/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = createApp();
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`English Listening running at http://localhost:${PORT}`);
});
