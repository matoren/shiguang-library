import { setTimeout as wait } from 'node:timers/promises';
import { proxyEndpoint } from '../glm-search.js';

const cases = [
  ['book', '生死疲劳'], ['book', '羊脂球'], ['film', '流浪地球2'],
  ['series', '漫长的季节'], ['game', '黑神话：悟空'], ['galgame', 'ATRI -My Dear Moments-']
];
const token = process.env.GLM_PROXY_TOKEN || '';
if (!process.argv.includes('--confirm') || !/^[A-Za-z0-9_-]{43}$/.test(token) || !process.env.GLM_PROXY_URL) {
  console.error('请设置 GLM_PROXY_URL 和单独的 GLM_PROXY_TOKEN，再传入 --confirm。最多发起六次可能计费的搜索。');
  process.exit(1);
}
let base;
try {
  const endpoint = new URL(process.env.GLM_PROXY_URL);
  const local = ['127.0.0.1', 'localhost'].includes(endpoint.hostname);
  base = proxyEndpoint(endpoint.href, local ? endpoint.origin : undefined);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
async function request(path, body) {
  const start = Date.now();
  try {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(29000),
      headers: {Authorization: 'Bearer ' + token, ...(body ? {'Content-Type': 'application/json'} : {})},
      body: body ? JSON.stringify(body) : undefined
    });
    return {http: response.status, elapsedMs: Date.now() - start, ...await response.json()};
  } catch {
    return {error: {code: 'connection', message: '代理连接失败、超时或未返回 JSON。'}};
  }
}
const before = await request('/status');
if (!before.ready) {
  console.error(JSON.stringify(before));
  process.exit(1);
}
console.log(JSON.stringify({before}));
for (const [index, [kind, title]] of cases.entries()) {
  if (index) await wait(5100);
  const result = await request('/search', {kind, title});
  console.log(JSON.stringify({kind, title, ...result}));
  if (['connection', 'proxy-auth', 'glm-auth', 'glm-balance', 'disabled', 'budget'].includes(result.error?.code)) {
    process.exitCode = 1;
    break;
  }
}
