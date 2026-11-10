import {searchAcross, boundedSource, exactFilmCandidates, filmTitleKey} from './search-policy.js';

const SETTINGS_KEY = 'remember-glm-proxy-v1';
const LABEL = 'GLM 联网搜索';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
let connection = null;
let pendingConnection = 0;
let preference = {enabled: false, endpoint: ''};

try {
  const saved = JSON.parse(globalThis.localStorage?.getItem(SETTINGS_KEY) || '{}');
  preference = {enabled: saved.enabled === true, endpoint: typeof saved.endpoint === 'string' ? saved.endpoint : ''};
} catch { /* The app also works with browser storage disabled. */ }

export function glmSettings() {
  return {...preference, connected: Boolean(connection), usage: connection?.usage};
}

export function setGlmEnabled(enabled) {
  preference.enabled = enabled;
  savePreference();
}

function savePreference() {
  try { globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(preference)); } catch {}
}

export function proxyEndpoint(value, origin = globalThis.location?.origin) {
  const site = origin ? new URL(origin) : null;
  const local = site && ['localhost', '127.0.0.1'].includes(site.hostname);
  if (!value.trim() && local) return site.origin + '/v1';
  try {
    const url = new URL(value.trim());
    const hosted = url.protocol === 'https:' && !url.port &&
      /\.(workers\.dev|tencentscf\.com)$/.test(url.hostname);
    if (!(hosted || local && url.origin === site.origin) || url.username || url.password ||
        url.search || url.hash || !['/', '/v1', '/v1/'].includes(url.pathname)) throw Error();
    return url.origin + '/v1';
  } catch {
    throw Error('请输入部署后的 HTTPS 代理网址（Workers 或腾讯云函数），本机预览可留空。');
  }
}

async function proxyRequest(session, path, {body, signal, fetcher = fetch} = {}) {
  let response;
  try {
    response = await fetcher(session.endpoint + path, {
      method: body ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: {Authorization: 'Bearer ' + session.token, ...(body ? {'Content-Type': 'application/json'} : {})},
      body: body ? JSON.stringify(body) : undefined, signal
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw Error('无法连接 GLM 代理，请检查代理网址、网络和允许的应用来源。');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error) {
    const error = Error(typeof data?.error?.message === 'string' ? data.error.message : 'GLM 代理返回异常。');
    error.code = data?.error?.code || 'glm-proxy';
    throw error;
  }
  return data;
}

export async function connectGlm(value, token) {
  const attempt = ++pendingConnection;
  const session = {endpoint: proxyEndpoint(value), token: token.trim()};
  if (!TOKEN.test(session.token)) throw Error('请填写代理访问口令（43 位）。');
  const status = await boundedSource(signal => proxyRequest(session, '/status', {signal}), undefined, 7000);
  if (attempt !== pendingConnection) return;
  if (!status.ready) throw Error('已验证代理口令。请先在服务端配置智谱密钥并启用搜索。');
  connection = {...session, usage: status.usage};
  preference.endpoint = session.endpoint;
  savePreference();
}

export function disconnectGlm() {
  ++pendingConnection;
  connection = null;
}

export async function searchGlm(type, title, {kind, scope, signal, refresh}) {
  if (!preference.enabled || !connection) throw Error('请先在“设置与数据”启用 GLM 搜索并连接代理。');
  const session = connection;
  const media = type === 'movie' ? kind === 'series' ? 'series' : 'film'
    : type === 'game' && scope === 'galgame' ? 'galgame' : type;
  const data = await proxyRequest(session, '/search', {body: {kind: media, title, ...(refresh ? {refresh: true} : {})}, signal});
  if (session === connection) session.usage = data.usage;
  if (!Array.isArray(data.items) || !Array.isArray(data.pages)) throw Error('GLM 代理返回的候选格式不正确。');
  const items = data.items.filter(candidate => candidate?.title && candidate.type === type &&
      (type !== 'movie' || candidate.screenType === kind))
    .map(candidate => ({
      id: candidate.id, type, ...(type === 'movie' ? {screenType: kind} : {}), title: candidate.title,
      creator: candidate.creator, releaseDate: candidate.releaseDate, year: type === 'book' ? '' : candidate.year, country: candidate.country,
      category: candidate.category, version: candidate.version, description: candidate.description,
      notice: '请核对字段证据和作品版本。',
      source: {provider: LABEL, url: candidate.source?.url, identity: candidate.source?.identity,
        fields: candidate.source?.fields, conflicts: candidate.source?.conflicts, pages: candidate.source?.pages}
    }));
  return {...data, items};
}

function withMatchingPosters(items) {
  return items.map(item => {
    if (item.source?.provider !== LABEL || item.imageUrl || item.imageName || !item.year || !item.creator) return item;
    const sameFilm = items.find(other => other.source?.provider !== LABEL && (other.imageUrl || other.imageName) &&
      String(other.year) === String(item.year) && filmTitleKey(other.creator) === filmTitleKey(item.creator) &&
      [other.title, ...(other.aliases || [])].some(name => filmTitleKey(name) === filmTitleKey(item.title)));
    return sameFilm ? {...item, imageUrl: sameFilm.imageUrl, imageName: sameFilm.imageName, coverSource: sameFilm.coverSource} : item;
  });
}

// Structured candidates keep their existing cache and source scheduler.
export async function searchLibrary(type, title, options, glm = searchGlm) {
  const {provider, signal, onProgress, onResults, onGlm} = options;
  const structured = provider === 'structured' ? 'auto' : provider;
  if (provider !== 'glm' && !(provider === 'auto' && options.includeGlm)) {
    return searchAcross(type, title, {...options, provider: structured});
  }
  const query = title.trim();
  if (!query || query.length > 150) throw Error('请输入 1—150 个字的作品名称');
  if (signal?.aborted) throw new DOMException('搜索已取消', 'AbortError');
  let combined = [];
  const seen = new Set();
  const present = () => type === 'movie' && options.kind === 'film' ? withMatchingPosters(combined) : [...combined];
  const append = items => {
    for (const candidate of items) {
      const key = JSON.stringify([candidate.source?.provider, candidate.id, candidate.source?.url]);
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(candidate);
    }
    onResults?.(present());
  };
  const glmAttempts = [];
  const structuredTask = provider === 'glm' ? Promise.resolve({attempts: [], items: []})
    : searchAcross(type, query, {...options, provider: 'auto', onResults: append}).then(result => {
      append(result.items);
      return result;
    });
  const started = Date.now();
  onProgress?.({source: 'glm', state: 'loading'});
  const glmTask = boundedSource(s => glm(type, query, {...options, signal: s}), signal, 29000).then(result => {
    const items = exactFilmCandidates(type, options.kind, query, result.items);
    const attempt = {source: 'glm', state: items.length ? 'success' : 'empty',
      count: items.length, ms: Date.now() - started, cached: result.cached === true,
      ...(result.extractionError && !items.length ? {state: 'error', message: result.extractionError} : {})};
    glmAttempts.push(attempt);
    onProgress?.(attempt);
    onGlm?.({...result, items});
    append(items);
  }).catch(error => {
    if (signal?.aborted) throw error;
    const attempt = {source: 'glm', state: 'error', code: error.code, message: error.message, ms: Date.now() - started};
    glmAttempts.push(attempt);
    onProgress?.(attempt);
  });
  const [database, ai] = await Promise.allSettled([structuredTask, glmTask]);
  if (signal?.aborted) throw new DOMException('搜索已取消', 'AbortError');
  if (database.status === 'rejected') {
    onProgress?.({source: 'structured', state: 'error', message: database.reason.message});
  }
  if (ai.status === 'rejected') throw ai.reason;
  return {items: present(), fromCache: false, attempts: [...(database.value?.attempts || []), ...glmAttempts]};
}
