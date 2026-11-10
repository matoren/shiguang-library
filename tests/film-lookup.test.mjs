import test from 'node:test';
import assert from 'node:assert/strict';
import {exactFilmCandidates, searchAcross} from '../search-policy.js';
import {restoreFilmFacts, retrieve, validateQuery} from '../proxy/zhipu.mjs';
import {createGateway} from '../proxy/gateway.mjs';
import {searchLibrary} from '../glm-search.js';
import {applyCandidate} from '../core.js';

const title = '欢迎来龙餐馆';
const input = validateQuery({kind:'film', title});
const summary = '导演: 文牧野 编剧: 文牧野 类型: 剧情 / 战争 制片国家/地区: 中国大陆 语言: 汉语普通话 上映日期: 2026-08-11(中国大陆) 片长: 140分钟';
const page = {id:1,title:'“欢迎来龙餐馆”电影资料',summary,url:'https://catalog.example.org/film',media:'测试'};
const wrong = {id:'wrong', title:'欢迎来到宇宙SHOW', creator:'舛成孝二', year:'2010', imageUrl:'https://lain.bgm.tv/wrong.jpg', source:{provider:'Bangumi',url:'https://bgm.tv/subject/123'}};

test('过滤错误影片与旧缓存，保留片名的明确别名', async () => {
  const alias = {...wrong,id:'alias',title:'原版片名',aliases:[title]};
  assert.deepEqual(exactFilmCandidates('movie','film','《' + title + '》',[wrong,alias]),[alias]);
  const progress=[];
  const result=await searchAcross('movie',title,{kind:'film',offline:false,
    cache:{get:()=>({items:[wrong]}),put(){}}, runner:async()=>[wrong], onProgress:a=>progress.push(a)});
  assert.deepEqual(result.items,[]);
  assert.equal(progress.at(-1).state,'empty');
});

test('明确标注的三个字段跳过模型，新闻文字只留作可核对来源', async () => {
  const calls=[];
  const fetcher=async (url, options)=>{
    calls.push(url);
    assert.match(JSON.parse(options.body).search_query,/^《欢迎来龙餐馆》/);
    assert.match(url,/\/web_search$/);
    return Response.json({search_result:[{link:page.url,title:page.title,content:page.summary},
      {link:'https://another.example/film',title:wrong.title,content:summary}]});
  };
  const result=await retrieve(input,{key:'fixture',engine:'search_pro',fetcher,onExtraction:()=>assert.fail('无需模型')});
  assert.equal(calls.length,1);
  assert.equal(result.pages.length,1);
  const [c]=result.items;
  assert.equal(c.creator,'文牧野');
  assert.equal(c.releaseDate,'2026-08-11');
  assert.equal(c.country,'中国大陆');
  assert.equal(c.source.fields.releaseDate.evidence[0].url,page.url);
  assert.equal(c.imageUrl,undefined);
});

test('限流或缓存重放仍保留已标注的字段，同页冲突日期留空', async () => {
  const partial={...page,summary:'导演：文牧野 制片国家/地区：中国大陆 取景地：中东'};
  const old={pages:[partial],items:[],extractionError:'限流'};
  assert.equal(restoreFilmFacts(old,input).items[0].country,'中国大陆');
  const failed=await retrieve(input,{key:'fixture',engine:'search_pro',onExtraction(){},fetcher:async url=>url.endsWith('/web_search')?
    Response.json({search_result:[{link:partial.url,title:partial.title,content:partial.summary}]}):
    Response.json({}, {status:429})});
  assert.match(failed.extractionError,/限流/);
  assert.equal(failed.items[0].creator,'文牧野');
  assert.equal(failed.items[0].releaseDate,'');
  const conflict={...page,summary:'上映日期：2026-08-11(中国大陆) 上映日期：2026-09-18(日本)'};
  assert.equal(restoreFilmFacts({pages:[conflict],items:[]},input).items[0].source.conflicts.releaseDate.length,2);
});

test('仅借用同名同年份同导演的图源，保留海报独立出处',async()=>{
  const ai={id:'glm',type:'movie',screenType:'film',title,creator:'文牧野',year:'2026',source:{provider:'GLM 联网搜索',url:page.url}};
  const poster={...wrong,title,creator:'文牧野',year:'2026',coverSource:{provider:'Bangumi',url:wrong.source.url}};
  const result=await searchLibrary('movie',title,{kind:'film',provider:'auto',includeGlm:true,offline:false,
    cache:{get(){},put(){}},runner:async(_,__,source)=>source==='bangumi'?[poster]:[wrong,{...poster,creator:'别的导演',id:'bad-poster',imageUrl:'https://lain.bgm.tv/bad.jpg'}]},
    async()=>({items:[ai]}));
  const c=result.items.find(item=>item.id==='glm');
  assert.equal(c.imageUrl,poster.imageUrl);
  assert.deepEqual(c.coverSource,poster.coverSource);
  assert.equal(c.source.url,page.url);
});

test('完整上映日与观影日期独立，原评分和评论仍保留',()=>{
  const record={type:'movie',screenType:'film',date:'2026-11-03',year:'2026',final:8,comment:'旧评论'};
  const c=restoreFilmFacts({pages:[page],items:[]},input).items[0];
  const saved=applyCandidate(record,c);
  assert.equal(saved.releaseDate,'2026-08-11');
  assert.equal(saved.date,'2026-11-03');
  assert.equal(saved.year,'2026');
  assert.equal(saved.final,8);
  assert.equal(saved.comment,'旧评论');
});

test('强制重新查询跳过 GLM 缓存，但继续受限额约束', async () => {
  let state;
  let calls = 0;
  let time = Date.parse('2026-11-09T10:00:00Z');
  const token = 'r'.repeat(43);
  const gateway = createGateway({
    GLM_PROXY_TOKEN:token, GLM_ALLOW_SEARCH:'true', ZHIPU_API_KEY:'fake', GLM_DAILY_LIMIT:'2'
  }, {get:()=>structuredClone(state),put:value=>{state=structuredClone(value);},transaction:fn=>fn()}, {
    now:()=>time,
    fetcher:async () => {
      calls++;
      return Response.json({search_result:[{link:page.url,title:page.title,content:page.summary}]});
    }
  });
  const request = refresh => gateway(new Request('https://proxy.example/v1/search', {
    method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({kind:'film',title,refresh})
  }));
  const first = await (await request(false)).json();
  assert.equal(first.cached,false);
  const cached = await (await request(false)).json();
  assert.equal(cached.cached,true);
  assert.equal(calls,1);
  time += 5100;
  const fresh = await (await request(true)).json();
  assert.equal(fresh.cached,false);
  assert.equal(fresh.usage.today,2);
  assert.equal(calls,2);
  assert.equal((await request(true)).status,429);
  assert.equal(calls,2);
});
