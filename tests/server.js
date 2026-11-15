const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || 8787);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/mock.js') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(path.join(__dirname, 'mock.js'))); }
  if (url === '/sw.js') { res.writeHead(404); return res.end(); }
  const p = path.join(ROOT, url === '/' ? 'index.html' : url);
  fs.readFile(p, (e, b) => {
    if (e) { res.writeHead(404); return res.end(); }
    let body = b;
    if (p.endsWith('index.html')) body = b.toString().replace('<script src="app.js"></script>', '<script src="mock.js"></script><script src="app.js"></script>');
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'text/plain', 'Cache-Control': 'no-store' });
    res.end(body);
  });
}).listen(PORT, () => console.log('mock server on', PORT));
