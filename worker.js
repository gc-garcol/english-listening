// Cloudflare Workers entry. Static files in public/ are served by Workers Assets
// (see wrangler.jsonc); only /api/* reaches Express.
import { httpServerHandler } from 'cloudflare:node';
import { createApp } from './lib/app.js';

const app = createApp();
app.listen(3000);

export default httpServerHandler({ port: 3000 });
