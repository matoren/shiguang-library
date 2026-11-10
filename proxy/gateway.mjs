import {ProxyError, retrieve, validateQuery, restoreFilmFacts} from './zhipu.mjs';

const MAX_BODY = 2048;
const TTL = 7 * 86400000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PERIOD_FORMAT = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'});
const count = (value, fallback) => /^\d+$/.test(value || '') ? Math.min(1000, Number(value)) : fallback;
const blank = () => ({total: 0, extracted: 0, failures: 0, day: '', daily: 0, month: '', monthly: 0, last: 0, cache: []});

async function bodyJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    throw new ProxyError('input', 415, '请求必须为 JSON。');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ProxyError('input', 400, '缺少搜索请求。');
  let bytes = 0;
  let text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY) {
        await reader.cancel();
        throw new ProxyError('input', 413, '搜索请求过长。');
      }
      text += decoder.decode(chunk.value, {stream: true});
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof ProxyError) throw error;
    throw new ProxyError('input', 400, '搜索请求格式不正确。');
  }
}

async function authorized(request, secret) {
  const header = request.headers.get('authorization') || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!TOKEN.test(supplied) || !TOKEN.test(secret || '')) return false;
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([supplied, secret].map(value => crypto.subtle.digest('SHA-256', encode.encode(value))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

// get and put must be synchronous and durable. Deploy one state owner for a given API budget.
export function createGateway(env, store, {fetcher = fetch, now = Date.now} = {}) {
  const allowed = new Set((env.GLM_ALLOWED_ORIGINS || 'https://matoren.github.io').split(',').map(x => x.trim()));
  const engine = env.GLM_SEARCH_ENGINE || 'search_pro';
  const dailyLimit = count(env.GLM_DAILY_LIMIT, 6);
  const monthlyLimit = count(env.GLM_MONTHLY_LIMIT, 30);
  const inFlight = new Map();
  const isReady = () => env.GLM_ALLOW_SEARCH === 'true' && Boolean(env.ZHIPU_API_KEY) &&
    ['search_pro', 'search_std'].includes(engine) && dailyLimit > 0 && monthlyLimit > 0;
  function stateAt(time) {
    const state = store.get() || blank();
    const day = PERIOD_FORMAT.format(new Date(time));
    const month = day.slice(0, 7);
    if (state.day !== day) { state.day = day; state.daily = 0; }
    if (state.month !== month) { state.month = month; state.monthly = 0; state.monthCents = 0; }
    state.cache = state.cache.filter(row => row.expires > time);
    return state;
  }
  function stats(state) {
    return {searches: state.total, extractions: state.extracted, failures: state.failures,
      today: state.daily, month: state.monthly, dailyLimit, monthlyLimit, engine,
      estimatedSearchYuan: (state.monthCents || 0) / 100};
  }
  return async request => {
    const origin = request.headers.get('origin');
    const headers = {'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff'};
    if (allowed.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const json = (data, status = 200) => Response.json(data, {status, headers});
    try {
      const url = new URL(request.url);
      if (origin && !allowed.has(origin)) throw new ProxyError('origin', 403, '代理未允许此应用网址。');
      const path = url.pathname.replace(/\/$/, '');
      if (!['/v1/search', '/v1/status'].includes(path)) throw new ProxyError('route', 404, '未找到代理接口。');
      if (request.method === 'OPTIONS' && origin) return new Response(null, {status: 204, headers: {
        ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600'
      }});
      if (!await authorized(request, env.GLM_PROXY_TOKEN)) throw new ProxyError('proxy-auth', 401, '代理访问口令无效。');
      if (path === '/v1/status' && request.method === 'GET') return json({ready: isReady(), usage: stats(stateAt(now()))});
      if (path !== '/v1/search' || request.method !== 'POST') throw new ProxyError('method', 405, '此接口不接受该请求方法。');
      if (!isReady()) throw new ProxyError('disabled', 503, 'GLM 搜索尚未在代理上启用。');
      const body = await bodyJson(request);
      const input = validateQuery(body);
      const key = JSON.stringify([engine, input.kind, input.title.toLowerCase()]);
      const time = now();
      const state = stateAt(time);
      const cached = state.cache.find(row => row.key === key);
      if (cached && body.refresh !== true) return json({...restoreFilmFacts(cached.result, input), cached: true, usage: stats(state)});
      let job = inFlight.get(key);
      if (!job) {
        store.transaction(() => {
          const current = stateAt(time);
          if (current.daily >= dailyLimit || current.monthly >= monthlyLimit) throw new ProxyError('budget', 429, '已达到代理设置的搜索次数上限。');
          if (inFlight.size || current.activeUntil > time || current.last && time - current.last < 5000) {
            throw new ProxyError('rate-limit', 429, '代理正在处理搜索或刚发起过搜索，请稍后再试。');
          }
          current.daily++;
          current.monthly++;
          current.monthCents = (current.monthCents || 0) + (engine === 'search_pro' ? 3 : 1);
          current.total++;
          current.last = time;
          current.activeUntil = time + 30000;
          store.put(current);
        });
        const update = mutate => store.transaction(() => {
          const latest = stateAt(now());
          mutate(latest);
          store.put(latest);
        });
        job = retrieve(input, {key: env.ZHIPU_API_KEY, engine, fetcher,
          onExtraction: () => update(s => { s.extracted++; })
        }).then(result => {
          update(s => {
            if (s.last === time) s.activeUntil = 0;
            if (result.extractionError) s.failures++;
            const ttl = result.extractionError || !result.items.length ? 3600000 : TTL;
            s.cache = [{key, expires: now() + ttl, result}, ...s.cache].slice(0, 24);
          });
          return result;
        }, error => {
          update(s => { if (s.last === time) s.activeUntil = 0; s.failures++; });
          throw error;
        }).finally(() => inFlight.delete(key));
        inFlight.set(key, job);
      }
      const result = await job;
      return json({...result, cached: false, usage: stats(stateAt(now()))});
    } catch (error) {
      if (error instanceof ProxyError) return json({error: {code: error.code, message: error.message}}, error.status);
      return json({error: {code: 'proxy', message: '代理暂时无法完成请求，请稍后再试。'}}, 503);
    }
  };
}
