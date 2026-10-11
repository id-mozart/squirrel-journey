import fs from 'node:fs';
import path from 'node:path';

// Отладочный приёмник снимков экрана (только dev): POST /__shot?name=xxx с PNG в теле.
const SHOT_DIR = process.env.SHOT_DIR || path.resolve('.shots');

export default {
  plugins: [{
    name: 'shot-receiver',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot').replace(/[^a-z0-9_-]/gi, '');
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          fs.mkdirSync(SHOT_DIR, { recursive: true });
          fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  }],
};
