import {searchWorks,clearRequestCache} from './online.js';
export const SOURCES={ndl:{label:'NDL 图书馆书目',note:'日本国立国会图书馆，含部分中文图书；仅元数据，无封面'},openlibrary:{label:'Open Library 图书版本',note:'中文覆盖有限，合并版本的作者署名需核对'},bangumi:{label:'Bangumi 中文社区',note:'影视与游戏覆盖有限；图书以动漫相关作品为主'},vndb:{label:'VNDB 视觉小说',note:'仅用于 Galgame / 视觉小说；元数据免费，封面需手动上传'},wikidata:{label:'Wikidata',note:'境外备用，部分网络无法连接'},tvmaze:{label:'TVmaze',note:'剧集备用，可尝试原名'}};
export const AUTO_ORDER=['bangumi','wikidata'];
export const automaticSources=(type,scope='general')=>type==='book'?['ndl','openlibrary']:type==='game'&&scope==='galgame'?['vndb','bangumi']:[...AUTO_ORDER];
export const sourceOptions=(type,kind,scope='general')=>type==='book'?['ndl','openlibrary','wikidata','bangumi']:type==='game'?[...(scope==='galgame'?['vndb','bangumi']:['bangumi','vndb']),'wikidata']:['bangumi','wikidata',...(kind==='series'?['tvmaze']:[])];
export function searchNote(type,scope='general'){return type==='book'?'自动：NDL 图书馆书目 → Open Library。中文版本覆盖有限，作者与版本请核对；书目源无封面，可换来源或手动上传。':type==='game'&&scope==='galgame'?'自动：VNDB 视觉小说 → Bangumi。VNDB 仅填入元数据，封面可手动上传。':'自动：Bangumi 中文社区 → Wikidata。当前免密钥可用组合，覆盖不完整；TMDb、IGDB、RAWG 尚未配置凭证。';}
export function externalSearches(type,title,kind='film'){
 const q=title.trim().slice(0,150),hint=type==='book'?'书籍 作者':type==='game'?'游戏 开发商':kind==='series'?'电视剧 主创':'电影 导演';
 return [{label:'在百度搜索',url:'https://www.baidu.com/s?'+new URLSearchParams({wd:q+' '+hint})},{label:'在百度百科搜索',url:'https://baike.baidu.com/search/word?'+new URLSearchParams({word:q})},{label:'在豆瓣搜索',url:'https://www.douban.com/search?'+new URLSearchParams({q:q+' '+(type==='book'?'书籍':type==='game'?'游戏':kind==='series'?'剧集':'电影')})}];
}
const CACHE_KEY='remember-public-metadata-v1',TTL=7*864e5;
export function metadataCache(storage){
 const read=()=>{try{const rows=JSON.parse(storage?.getItem(CACHE_KEY)||'[]');return Array.isArray(rows)?rows.filter(r=>r&&typeof r.at==='number'&&Date.now()-r.at<TTL&&Array.isArray(r.items)).slice(0,24):[];}catch{return [];}};
 return {get(key){const r=read().find(r=>r.key===key);return r?structuredClone(r):null;},put(key,items){if(!items.length)return;try{const rows=read().filter(r=>r.key!==key);rows.unshift({key,at:Date.now(),items:structuredClone(items)});storage?.setItem(CACHE_KEY,JSON.stringify(rows.slice(0,24)));}catch{/* Cache failure never prevents lookup or saving a work. */}}};
}
function localCache(){try{return metadataCache(globalThis.localStorage);}catch{return metadataCache(null);}}
function abortError(){return new DOMException('搜索已取消','AbortError');}
// Each source is tried once. The bound includes all requests, waits and JSON parsing.
export async function boundedSource(task,signal,ms){
 if(signal?.aborted)throw abortError();const ctl=new AbortController();let timer,onAbort;
 const stopped=new Promise((_,reject)=>{onAbort=()=>{ctl.abort();reject(abortError());};signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>{ctl.abort();const e=Error('本来源检索达到时间上限');e.code='timeout';reject(e);},ms);});
 try{return await Promise.race([Promise.resolve().then(()=>task(ctl.signal)),stopped]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
export async function searchAcross(type,query,{provider='auto',kind='film',scope='general',signal,onProgress=()=>{},refresh=false,offline=globalThis.navigator?.onLine===false,runner=searchWorks,cache=localCache(),budgets={bangumi:9000,wikidata:12000,openlibrary:8000,tvmaze:8000,ndl:8000,vndb:8000}}={}){
 query=query.trim();if(!query||query.length>150)throw Error('请输入 1—150 个字的作品名称');if(signal?.aborted)throw abortError();
 const allowed=sourceOptions(type,kind,scope);if(provider!=='auto'&&!allowed.includes(provider))throw Error('所选来源不支持当前作品类型');
 const key=JSON.stringify(['strategy-v23',type,kind,scope,query,provider]),cached=!refresh&&cache.get(key);if(cached){onProgress({source:'cache',state:'cached',count:cached.items.length});return {items:cached.items,attempts:[],cachedAt:cached.at,fromCache:true};}
 if(offline){const attempt={source:'network',state:'error',code:'offline',message:'当前处于离线状态，且没有可用候选缓存；可继续手动填写'};onProgress(attempt);return {items:[],attempts:[attempt],fromCache:false};}
 if(refresh&&runner===searchWorks)clearRequestCache();
 const plan=provider==='auto'?automaticSources(type,scope):[provider],attempts=[];
 for(const source of plan){
  if(signal?.aborted)throw abortError();const start=Date.now();onProgress({source,state:'loading'});
  try{const items=await boundedSource(s=>runner(type,query,source,s,kind),signal,budgets[source]);if(!Array.isArray(items))throw Error('候选结果格式不正确');
   const attempt={source,state:items.length?'success':'empty',count:items.length,ms:Date.now()-start};attempts.push(attempt);onProgress(attempt);
   if(items.length){cache.put(key,items);return {items,attempts,fromCache:false};}
  }catch(e){if(signal?.aborted)throw abortError();const attempt={source,state:'error',code:e.code||'unknown',message:e.message||'来源暂时不可用',ms:Date.now()-start};attempts.push(attempt);onProgress(attempt);}
 }
 return {items:[],attempts,fromCache:false};
}
