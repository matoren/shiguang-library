export const CATEGORIES=['文学小说','散文随笔','哲学思想','专业学术','教材工具'];
export const WEIGHTS=[[25,20,20,10,15,10],[20,25,25,5,15,10],[25,30,15,10,5,15],[30,20,15,15,5,15],[30,10,20,5,10,25]];
export const MOVIE_WEIGHTS=[35,25,20,20];
export const GAME_WEIGHTS=[35,25,20,20];
export const GAME_DIMS=['游戏性与机制','剧情与内容','视听与表现','游戏体验'];
export const TYPES=['book','movie','game'];
export const TYPE_LABELS={book:'书籍',movie:'电影',game:'游戏'};
export const STATUSES={book:['想读','在读','已读','弃读'],movie:['想看','已看','弃看'],game:['想玩','在玩','已通关','已完成','已弃玩']};
export const isDone=r=>({book:['已读'],movie:['已看'],game:['已通关','已完成']}[r.type]||[]).includes(r.status);
export const dimensions=type=>type==='book'?BOOK_DIMS:type==='game'?GAME_DIMS:MOVIE_DIMS;
export const BOOK_DIMS=['内容质量','思想深度','表达水平','创新程度','阅读体验','个人价值'];
export const MOVIE_DIMS=['剧情与内容','视听与表演','艺术与思想','观影体验'];
export const DEFINITIONS=['内容准确、完整、合理，故事人物与论证结构是否扎实。','思想洞察、思考空间和启发性；晦涩不等于深刻。','语言、文笔、结构和叙述效果；专业作品重视概念解释清晰。','思想、设定、结构或方法的独创性；兼顾创作时代。','投入、流畅、趣味及整体体验；易读不等于优秀。','对个人知识、认知、情感和实际能力产生的价值。'];
export const validScore=s=>typeof s==='number'&&Number.isFinite(s)&&s>=0&&s<=10;
export function calculate(scores,weights){let n=0,d=0;scores.forEach((s,i)=>{if(validScore(s)){n+=Math.round(s*10)*weights[i];d+=weights[i];}});return d?Math.floor((n*2+d)/(2*d))/10:null;}
export const grade=s=>!validScore(s)?'未评分':s>=9.5?'杰作':s>=9?'卓越':s>=8?'优秀':s>=7?'良好':s>=6?'一般':s>=5?'欠佳':'较差';
export const scoreText=s=>validScore(s)?`${s<7?'✳ ':''}${s.toFixed(1)}`:'未评分';
export function finalScore(r){return r.mode==='quick'?r.quick:r.adjusted?r.manual:r.computed;}
export const defaults=()=>({theme:'light',weights:WEIGHTS.map(w=>[...w]),ruleVersion:1,lastBackup:null});
export function ranked(records,type,category='',year=''){return records.filter(r=>r.type===type&&isDone(r)&&validScore(r.final)&&(!category||r.category===category)&&(!year||r.date?.startsWith(year))).sort((a,b)=>b.final-a.final||a.created.localeCompare(b.created)||a.id.localeCompare(b.id));}
export function stats(records,type,year){const done=records.filter(r=>r.type===type&&isDone(r));const rated=done.filter(r=>validScore(r.final));return {count:done.length,average:rated.length?(rated.reduce((s,r)=>s+r.final,0)/rated.length).toFixed(1):'—',year:done.filter(r=>r.date?.startsWith(String(year))).length};}
function assert(ok,msg){if(!ok)throw Error(msg);}
function checkWeights(w,n){assert(Array.isArray(w)&&w.length===n&&w.every(x=>Number.isInteger(x)&&x>=0&&x<=100)&&w.reduce((a,b)=>a+b,0)===100,'评分权重不合法');}
export function validateBackup(data){assert(data&&data.format==='private-media-library'&&data.schemaVersion===1,'不支持的备份格式或版本');assert(Array.isArray(data.records)&&data.records.length<=50000,'记录格式不正确');assert(data.settings&&['light','dark'].includes(data.settings.theme),'设置格式不正确');assert(Array.isArray(data.settings.weights)&&data.settings.weights.length===5,'分类权重不正确');data.settings.weights.forEach(w=>checkWeights(w,6));assert(Number.isInteger(data.settings.ruleVersion)&&data.settings.ruleVersion>0,'规则版本不正确');assert(data.settings.lastBackup===null||(typeof data.settings.lastBackup==='string'&&!Number.isNaN(Date.parse(data.settings.lastBackup))),'上次备份日期不正确');const ids=new Set();for(const r of data.records){assert(r&&typeof r.id==='string'&&r.id.length>0&&!ids.has(r.id),'记录 ID 缺失或重复');ids.add(r.id);assert(TYPES.includes(r.type)&&typeof r.title==='string'&&r.title.trim().length>0&&r.title.length<=300,'作品名称或类型不正确');assert(typeof r.creator==='string'&&typeof r.category==='string'&&Array.isArray(r.tags)&&r.tags.every(t=>typeof t==='string'),'作品信息不完整');assert(['standard','quick'].includes(r.mode)&&!(r.type==='book'&&r.mode==='quick'),'评分模式不正确');assert(STATUSES[r.type].includes(r.status),'作品状态不正确');assert(r.type!=='book'||CATEGORIES.includes(r.category),'书籍分类不正确');checkWeights(r.weights,r.type==='book'?6:4);assert(Array.isArray(r.scores)&&r.scores.length===r.weights.length&&r.scores.every(s=>s===null||(validScore(s)&&Number.isInteger(s*2))),'维度评分不正确');for(const k of ['computed','final','manual','quick'])assert(r[k]===null||(validScore(r[k])&&Math.abs(r[k]*10-Math.round(r[k]*10))<1e-8),'总评分不正确');assert(typeof r.adjusted==='boolean'&&r.computed===calculate(r.scores,r.weights)&&r.final===finalScore(r),'评分数据不一致');assert(!r.adjusted||validScore(r.manual),'缺少手动最终分');assert(typeof r.comment==='string'&&r.comment.length<=20000&&typeof r.created==='string'&&!Number.isNaN(Date.parse(r.created))&&typeof r.updated==='string'&&!Number.isNaN(Date.parse(r.updated)),'日期或评论格式不正确');assert(typeof r.date==='string'&&(!r.date||/^\d{4}-\d{2}-\d{2}$/.test(r.date)),'完成日期不正确');for(const k of ['cover','thumb'])assert(r[k]===null||(typeof r[k]==='string'&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r[k])&&r[k].length<12000000),'封面图片不正确');}return structuredClone(data);}
export function backup(records,settings){return {format:'private-media-library',schemaVersion:1,exportedAt:new Date().toISOString(),records,settings};}
const identity=r=>[r.type,r.title.trim().toLocaleLowerCase(),r.type==='book'?r.creator.trim().toLocaleLowerCase():'',r.type==='book'?'':String(r.year||'')].join('|');
export function mergeRecords(current,incoming){const out=[...current],conflicts=[];for(const r of incoming){const found=out.find(x=>x.id===r.id||identity(x)===identity(r));if(found)conflicts.push({existing:found,incoming:r});else out.push(r);}return {records:out,conflicts};}



export function featured(records,limit=8){return records.filter(r=>isDone(r)&&validScore(r.final)).sort((a,b)=>b.final-a.final||a.created.localeCompare(b.created)||a.id.localeCompare(b.id)).slice(0,limit);}
export function applyCandidate(record,candidate){if(record.type!==candidate.type)throw Error('搜索结果类型不匹配');const next=structuredClone(record);for(const key of ['title','creator'])if(candidate[key])next[key]=candidate[key];if(record.type!=='book'){for(const key of ['year','category'])if(candidate[key])next[key]=candidate[key];if(record.type==='movie'&&candidate.country)next.country=candidate.country;}if(candidate.source)next.source=structuredClone(candidate.source);if(candidate.cover&&/^data:image\/(png|jpeg|webp);base64,/.test(candidate.cover)){next.cover=candidate.cover;next.thumb=candidate.thumb||candidate.cover;next.coverSource=structuredClone(candidate.coverSource||candidate.source||null);}return next;}
