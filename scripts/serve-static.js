#!/usr/bin/env node
// Minimal static server with GitHub-Pages-like semantics (directory -> index.html,
// no SPA fallback), used for previewing and testing the dual build locally.
//   node scripts/serve-static.js [dir=dist-dual] [port=4173] [host=127.0.0.1] [mount=/pathmap/]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const [dir = 'dist-dual', port = '4173', host = '127.0.0.1', mount = '/pathmap/'] = process.argv.slice(2);
const root = path.resolve(dir);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === mount.replace(/\/$/, '')) {
    res.writeHead(301, { Location: mount });
    return res.end();
  }
  if (!pathname.startsWith(mount)) {
    res.writeHead(404);
    return res.end('Not found (site is mounted at ' + mount + ')');
  }
  pathname = pathname.slice(mount.length);
  let file = path.join(root, pathname);
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end();
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!pathname.endsWith('/') && pathname !== '') {
      res.writeHead(301, { Location: url.pathname + '/' });
      return res.end();
    }
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

server.listen(Number(port), host, () => {
  console.log(`serving ${root} at http://${host}:${port}${mount}`);
});
