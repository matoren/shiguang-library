import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.LIBRARY_PORT) || 4173;
const origin = 'http://127.0.0.1:' + port;
const root = path.dirname(fileURLToPath(import.meta.url));
const glmEnabled = process.env.GLM_ALLOW_SEARCH === 'true';
const glm = glmEnabled ? (await import('./proxy/local.mjs')).localGateway(process.env, origin) : null;
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};

http.createServer(async (request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, origin).pathname); }
  catch { response.writeHead(400).end(); return; }
  if (pathname.startsWith('/v1/')) {
    if (!glm) {
      response.writeHead(503, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
      response.end(JSON.stringify({error:{code:'disabled',message:'本机代理尚未配置或启用。'}}));
      return;
    }
    try {
      const init = {method:request.method, headers:request.headers};
      if (!['GET','HEAD'].includes(request.method)) {
        init.body = Readable.toWeb(request);
        init.duplex = 'half';
      }
      const result = await glm(new Request(origin + pathname, init));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      if (!response.headersSent) response.writeHead(503).end();
      else response.destroy();
    }
    return;
  }
  const relative = pathname.replace(/^\/library\//, '/');
  const asset = relative === '/' ? '/index.html' : relative;
  const file = path.resolve(root, '.' + asset);
  const mime = types[path.extname(file)];
  if (!file.startsWith(root + path.sep) || !mime || asset.split('/').some(segment => segment.startsWith('.')) ||
      asset.includes('\\') || asset.startsWith('/proxy/')) {
    response.writeHead(404).end();
    return;
  }
  fs.readFile(file, (error, body) => {
    if (error) { response.writeHead(404).end(); return; }
    response.writeHead(200, {'Content-Type':mime, 'Cache-Control':'no-cache'});
    response.end(body);
  });
}).listen(port, glmEnabled ? '127.0.0.1' : '0.0.0.0', () => console.log('Local: ' + origin + '/library/'));
