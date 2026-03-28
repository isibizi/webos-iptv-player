import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';

const PORT = 3000;
const DIR = 'dist';

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
};

createServer(async (req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;
  const file = join(DIR, url);
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`Preview: http://localhost:${PORT}`);
});
