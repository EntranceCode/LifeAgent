import http from 'node:http';
import { readFile } from 'node:fs/promises';
const files = { '/': ['index.html','text/html'], '/index.html': ['index.html','text/html'], '/styles.css': ['styles.css','text/css'], '/app.js': ['app.js','text/javascript'], '/model.js': ['model.js','text/javascript'] };
const server = http.createServer(async (req,res) => {
  const entry = files[new URL(req.url,'http://localhost').pathname];
  if (!entry) { res.writeHead(404); res.end('Not found'); return; }
  try { const body = await readFile(new URL(entry[0],import.meta.url)); res.writeHead(200,{'Content-Type':entry[1]+'; charset=utf-8','Cache-Control':'no-store'}); res.end(body); }
  catch { res.writeHead(500); res.end('Unable to read file'); }
});
server.listen(4173,'127.0.0.1',()=>console.log('ExploreOS: http://localhost:4173'));
