// Public, key-free providers. Only explicit search text leaves the device.
const cache=new Map();const nextRequest=new Map();
const WIKI='https://www.wikidata.org/w/api.php',COMMONS='https://commons.wikimedia.org/w/api.php';
const values=(e,p)=>{let claims=(e.claims?.[p]||[]).filter(s=>s.rank!=='deprecated');if(claims.some(s=>s.rank==='preferred'))claims=claims.filter(s=>s.rank==='preferred');return claims.map(s=>s.mainsnak?.datavalue?.value).filter(v=>v!==undefined);};
const ids=(e,p)=>values(e,p).map(v=>v.id).filter(Boolean);
const label=e=>['zh-hans','zh-cn','zh','en'].map(l=>e?.labels?.[l]?.value).find(Boolean)||'';
const plain=s=>String(s||'').replace(/<[^>]*>/g,'').slice(0,1500);
const api=(url,params)=>url+'?'+new URLSearchParams({format:'json',origin:'*',maxlag:'5',...params});
export function allowsImage(url){try{const u=new URL(url);return u.protocol==='https:'&&['upload.wikimedia.org','thumb.wikimedia.org','covers.openlibrary.org','static.tvmaze.com','lain.bgm.tv'].includes(u.hostname);}catch{return false;}}
export function usableLicense(name){return /^(public domain|cc0|cc by(?:-sa)?(?:\s|$))/i.test(name||'');}
export class SearchError extends Error{constructor(code,message,stage='请求',status=null){super(message);this.name='SearchError';this.code=code;this.stage=stage;this.status=status;}}
export function clearRequestCache(){cache.clear();}
function aborted(){return new DOMException('搜索已取消','AbortError');}
function waitFor(ms,signal){if(signal?.aborted)return Promise.reject(aborted());return new Promise((resolve,reject)=>{const stop=()=>{clearTimeout(timer);reject(aborted());},timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);signal?.addEventListener('abort',stop,{once:true});});}
async function json(url,signal,fetcher=fetch,{timeoutMs=8000,stage='查询资料',method='GET',body}={}){
 if(signal?.aborted)throw aborted();const key=method+' '+url+' '+(body||'');if(cache.has(key))return structuredClone(cache.get(key));
 const host=new URL(url).hostname;await waitFor(Math.max(0,(nextRequest.get(host)||0)-Date.now()),signal);nextRequest.set(host,Date.now()+1000);
 const ctl=new AbortController();let timer,onAbort,timedOut=false;
 const stopped=new Promise((_,reject)=>{onAbort=()=>{ctl.abort();reject(aborted());};signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>{timedOut=true;ctl.abort();reject(new SearchError('timeout',stage+'超时，可换来源或继续手动填写',stage));},timeoutMs);});
 try{
  const data=await Promise.race([(async()=>{let r;try{r=await fetcher(url,{method,body,headers:body?{'Content-Type':'application/json'}:undefined,signal:ctl.signal,credentials:'omit',referrerPolicy:'no-referrer'});}catch(e){if(signal?.aborted)throw aborted();if(timedOut)throw new SearchError('timeout',stage+'超时',stage);throw new SearchError('network',stage+'无法连接（网络或跨域限制，浏览器无法进一步区分）',stage);}
   if(r.status===429)throw new SearchError('rate-limit',stage+'被限流，请稍后手动重试',stage,429);
   if(!r.ok)throw new SearchError('http',stage+'服务返回 HTTP '+r.status,stage,r.status);
   let data;try{data=await r.json();if(!data||typeof data!=='object')throw Error();}catch(e){if(ctl.signal.aborted)throw e;throw new SearchError('format',stage+'结果无法解析',stage);}
   if(data.error)throw new SearchError('api',stage+'接口报告错误，暂时不可用',stage);return data;
  })(),stopped]);
  if(signal?.aborted)throw aborted();cache.set(key,data);if(cache.size>80)cache.delete(cache.keys().next().value);return structuredClone(data);
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
async function entities(entityIds,signal,props='labels|descriptions|claims'){if(!entityIds.length)return {};entityIds=[...new Set(entityIds)];if(entityIds.length>40){let all={};for(let i=0;i<entityIds.length;i+=40)Object.assign(all,await entities(entityIds.slice(i,i+40),signal,props));return all;}const data=await json(api(WIKI,{action:'wbgetentities',ids:[...new Set(entityIds)].join('|'),props,languages:'zh-hans|zh-cn|zh|en',languagefallback:'1'}),signal,fetch,{stage:props==='labels'?'查询创作者与类型名称':'读取作品详情',timeoutMs:props==='labels'?3500:6000});if(!data.entities||typeof data.entities!=='object'||Array.isArray(data.entities))throw new SearchError('format','Wikidata 作品详情格式不正确');return data.entities;}
export function matchesType(e,type,kind='film'){const classes=ids(e,'P31'),desc=Object.values(e.descriptions||{}).map(x=>x.value).join(' ');const game=classes.includes('Q7889')||/video game|电子游戏|電子遊戲/i.test(desc);if(type==='game')return game||ids(e,'P178').length>0;const series=classes.some(c=>['Q5398426','Q581714','Q1259759'].includes(c))||/television series|TV series|anime series|电视剧|電視劇|电视动画|電視動畫|网络剧|網絡劇|纪录片剧集/i.test(desc);const season=classes.includes('Q3464665')||classes.includes('Q21191270')||/television season|television episode|电视剧季|電視劇季/i.test(desc);if(type==='movie'&&kind==='series')return !game&&series&&!season;if(type==='movie')return !game&&!series&&(classes.includes('Q11424')||(/film|电影|電影/i.test(desc)&&ids(e,'P57').length>0));return !game&&!classes.includes('Q11424')&&(ids(e,'P50').length>0||classes.some(c=>['Q571','Q7725634','Q8261','Q49084'].includes(c)));}
export function candidateFromEntity(e,related,type,kind='film'){const names=p=>ids(e,p).map(id=>label(related[id])).filter(Boolean).join(' / ');const dates=[...values(e,'P577'),...(type==='movie'&&kind==='series'?values(e,'P580'):[])].map(v=>v.time?.match(/^\+(\d{4})-/)?.[1]).filter(Boolean).sort();return {id:e.id,type,...(type==='movie'?{screenType:kind}:{}),title:label(e),creator:names(type==='book'?'P50':type==='game'?'P178':'P57')||(type==='movie'&&kind==='series'?names('P170'):''),country:type==='movie'?names('P495'):'',year:type==='book'?'':dates[0]||'',version:type==='book'?(dates[0]?`原作 / 版本信息：${dates[0]}`:'版本信息不详'):'',category:type==='book'?'':names('P136'),imageName:values(e,'P18')[0]||'',description:['zh-hans','zh-cn','zh','en'].map(l=>e.descriptions?.[l]?.value).find(Boolean)||'',source:{provider:'Wikidata',id:e.id,url:'https://www.wikidata.org/wiki/'+e.id,license:'CC0'}};}
export async function addImages(candidates,signal){const withImages=candidates.filter(c=>c.imageName).slice(0,5);if(!withImages.length)return candidates;try{const data=await json(api(COMMONS,{action:'query',titles:withImages.map(c=>'File:'+c.imageName).join('|'),prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'900',iiextmetadatafilter:'LicenseShortName|LicenseUrl|Artist|Attribution|UsageTerms'}),signal,fetch,{stage:'核对封面许可',timeoutMs:3500});for(const page of Object.values(data.query?.pages||{})){const info=page.imageinfo?.[0],m=info?.extmetadata;const license=plain(m?.LicenseShortName?.value);if(!info||!usableLicense(license)||!allowsImage(info.thumburl||info.url))continue;const c=withImages.find(c=>('File:'+c.imageName).replaceAll('_',' ')===page.title.replaceAll('_',' '));if(c){c.imageUrl=info.thumburl||info.url;c.coverSource={provider:'Wikimedia Commons',url:info.descriptionurl,license,licenseUrl:m?.LicenseUrl?.value||'',artist:plain(m?.Artist?.value),note:'封面已做尺寸缩放与压缩。原图可能为版本插图或参考图，请核对是否适合作封面。'};}}}catch(e){if(signal?.aborted)throw e;for(const c of withImages)c.imageNotice=e.message;}return candidates;}
export async function searchWorks(type,query,provider='wikidata',signal,kind='film'){query=query.trim();if(query.length<1||query.length>150)throw Error('请输入 1—150 个字的作品名称');if(provider==='bangumi')return searchBangumi(type,query,signal,kind);if(!['wikidata','openlibrary','tvmaze'].includes(provider))throw Error('未知搜索来源');if(provider==='tvmaze'){if(type!=='movie'||kind!=='series')throw Error('TVmaze 仅用于剧集搜索');const rows=await json('https://api.tvmaze.com/search/shows?'+new URLSearchParams({q:query}),signal);if(!Array.isArray(rows))throw new SearchError('format','TVmaze 候选格式不正确');return rows.filter(r=>r?.show?.id).slice(0,8).map(({show})=>candidateFromTVmaze(show));}if(provider==='openlibrary'&&type==='book'){const d=await json('https://openlibrary.org/search.json?'+new URLSearchParams({q:query,lang:'zh',limit:'8',fields:'key,title,author_name,cover_i,first_publish_year,edition_count'}),signal);if(!Array.isArray(d.docs))throw new SearchError('format','Open Library 候选格式不正确');return d.docs.map(r=>({id:r.key,type:'book',title:r.title,creator:(r.author_name||[]).join(' / '),country:'',year:'',version:`${r.first_publish_year||'未知年份'} · ${r.edition_count||1} 个版本`,imageUrl:r.cover_i?`https://covers.openlibrary.org/b/id/${r.cover_i}-L.jpg?default=false`:'',source:{provider:'Open Library',url:'https://openlibrary.org'+(r.key.startsWith('/')?'':'/works/')+r.key},coverSource:{provider:'Open Library Covers',url:'https://openlibrary.org'+r.key,license:'封面权利归原权利人；来自公开封面 API，仅作个人记录'}}));}
const result=await json(api(WIKI,{action:'wbsearchentities',search:query,language:'zh',uselang:'zh',limit:'10',type:'item'}),signal);if(!Array.isArray(result.search))throw new SearchError('format','Wikidata 候选格式不正确');let found=result.search;if(!found.length&&/[A-Za-z]/.test(query)){const en=await json(api(WIKI,{action:'wbsearchentities',search:query,language:'en',uselang:'zh',limit:'10',type:'item'}),signal);if(!Array.isArray(en.search))throw new SearchError('format','Wikidata 英文候选格式不正确');found=en.search;}const es=await entities(found.map(x=>x.id),signal);const picked=found.map(r=>es[r.id]).filter(e=>e&&matchesType(e,type,kind)).slice(0,8);const relatedIds=picked.flatMap(e=>['P50','P57','P170','P178','P495','P136'].flatMap(p=>ids(e,p)));let related={},notice='';try{related=await entities(relatedIds,signal,'labels');}catch(e){if(signal?.aborted)throw e;notice='部分创作者或类型名称未取得：'+e.message;}return picked.map(e=>({...candidateFromEntity(e,related,type,kind),...(notice?{notice}:{})}));}
export async function downloadImage(candidate,signal){
 if(signal?.aborted)throw aborted();if(candidate.imageName&&!candidate.imageUrl)await addImages([candidate],signal);
 if(!candidate.imageUrl||!allowsImage(candidate.imageUrl))return null;
 const ctl=new AbortController(),stop=()=>ctl.abort(),timer=setTimeout(stop,6000);signal?.addEventListener('abort',stop,{once:true});
 try{if(signal?.aborted)throw aborted();const r=await fetch(candidate.imageUrl,{signal:ctl.signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok)throw Error('封面下载失败，信息仍可填入，请手动上传封面');const size=Number(r.headers.get('content-length')||0);if(size>15*1024*1024)throw Error('搜索封面过大，请手动上传');const blob=await r.blob();if(blob.size>15*1024*1024||!/^image\/(jpeg|png|webp|gif)$/.test(blob.type))throw Error('搜索封面格式不支持，请手动上传');return blob;}finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);}
}

export {json as requestJSON};

// A show, never a season/episode. Network location is not a production country.
export function candidateFromTVmaze(show){return {id:'tvmaze-'+show.id,type:'movie',screenType:'series',title:show.name||'',creator:'',year:show.premiered?.slice(0,4)||'',country:'',category:(show.genres||[]).join(' / '),description:plain(show.summary).slice(0,180),imageUrl:show.image?.medium||'',source:{provider:'TVmaze',url:show.url||'https://www.tvmaze.com/shows/'+show.id,license:'CC BY-SA'},coverSource:{provider:'TVmaze',url:show.url||'https://www.tvmaze.com/shows/'+show.id,license:'CC BY-SA',note:'来自 TVmaze 公开 API；保存了缩放后的参考海报，权利与署名遵循来源说明。'}};}




const infoValue=v=>typeof v==='string'?plain(v):Array.isArray(v)?v.map(x=>typeof x==='string'?plain(x):plain(x?.v||'')).filter(Boolean).join(' / '):'';
const info=(s,keys)=>keys.map(k=>infoValue(s.infobox?.find(x=>x.key===k)?.value)).find(Boolean)||'';
export function matchesBangumi(s,type,kind='film',query=''){
 if(!s||!Number.isSafeInteger(s.id)||s.id<1)return false;
 if(type==='book')return s.type===1;if(type==='game')return s.type===4;
 const platform=String(s.platform||'');if(![2,6].includes(s.type))return false;
 if(kind==='film')return /^(剧场版|电影)$/.test(platform);
 const series=/^(TV|WEB|OVA|日剧|欧美剧|华语剧|电视剧|网络剧|韩剧|特摄)$/.test(platform);
 const season=/第[一二三四五六七八九十百0-9]+季|season\s*\d+/i;
 return series&&(!season.test(s.name_cn||s.name)||season.test(query));
}
export function candidateFromBangumi(s,type,kind='film'){
 const source={provider:'Bangumi',id:String(s.id),url:'https://bgm.tv/subject/'+s.id,license:'CC BY-SA；封面等既有版权内容依来源权利说明',licenseUrl:'https://bgm.tv/about/copyright'};
 const title=plain(s.name_cn||s.name).slice(0,300),year=typeof s.date==='string'&&/^\d{4}-/.test(s.date)?s.date.slice(0,4):'';
 const imageUrl=s.images?.common||s.images?.medium||'';
 return {id:'bangumi-'+s.id,type,...(type==='movie'?{screenType:kind}:{}),title,
  creator:info(s,type==='book'?['作者']:type==='game'?['开发','开发商']:['导演','監督','总导演','總導演','シリーズ監督']),
  country:type==='movie'?info(s,['国家/地区','国家／地区','製作国']):'',year:type==='book'?'':year,
  category:type==='book'?'':info(s,type==='game'?['游戏类型']:['类型'])||(type==='movie'&&s.type===2?'动画':''),
  version:type==='book'?info(s,['版本','版本信息']):'',description:s.name&&s.name!==title?'原名：'+plain(s.name).slice(0,100):String(s.platform||''),source,
  ...(allowsImage(imageUrl)?{imageUrl,coverSource:{...source,note:'来自 Bangumi 公开条目，缩放压缩后仅用于个人收藏；封面权利归原权利人，保留来源与权利说明。'}}:{})};
}
async function searchBangumi(type,query,signal,kind){
 const types=type==='book'?[1]:type==='game'?[4]:[2,6];
 const d=await json('https://api.bgm.tv/v0/search/subjects?limit=12',signal,fetch,{stage:'Bangumi 中文标题查询',method:'POST',body:JSON.stringify({keyword:query,sort:'match',filter:{type:types,nsfw:false}})});
 if(!Array.isArray(d.data)||!d.data.every(s=>s&&Number.isSafeInteger(s.id)&&Number.isInteger(s.type)))throw new SearchError('format','Bangumi 候选格式不正确');
 return d.data.filter(s=>matchesBangumi(s,type,kind,query)).slice(0,8).map(s=>candidateFromBangumi(s,type,kind));
}

