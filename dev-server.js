// Tiny static server with HTTP Range support (like GitHub Pages / Netlify).
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || '.'), port = +process.argv[3] || 8766;
const types = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  const size = fs.statSync(f).size, type = types[path.extname(f)] || 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const start = m[1] ? +m[1] : size - +m[2], end = m[1] && m[2] ? +m[2] : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return req.method === 'HEAD' ? res.end() : fs.createReadStream(f, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size, 'Cache-Control': 'no-cache' });
  req.method === 'HEAD' ? res.end() : fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('serving on ' + port));
