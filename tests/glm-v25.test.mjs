import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../proxy/gateway.mjs';
import { validateQuery, searchPages, groundedCandidates } from '../proxy/zhipu.mjs';
import { proxyEndpoint, searchLibrary } from '../glm-search.js';

const origin = 'https://matoren.github.io';
const token = 't'.repeat(43);
const env = {ZHIPU_API_KEY:'fixture-provider-key', GLM_PROXY_TOKEN:token, GLM_ALLOW_SEARCH:'true'};
const testUrl = 'https://example.org/v1';
const resultUrl = 'https://catalog.example.org/item';
function fixtureStore() {
  let data;
  return {get:()=>structuredClone(data),put:x=>{data=structuredClone(x);},transaction:fn=>fn()};
}
function request(kind, title, overrides = {}) {
  return new Request(testUrl + '/search', {
    method:'POST', headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json',...overrides},
    body:JSON.stringify({kind,title})
  });
}
const cases = [
  ['book','生死疲劳','小说','作者','莫言'],
  ['book','羊脂球','图书','作者','莫泊桑'],
  ['film','流浪地球2','电影','导演','郭帆'],
  ['series','漫长的季节','电视剧','导演','辛爽'],
  ['game','黑神话：悟空','游戏','开发商','游戏科学'],
  ['galgame','ATRI -My Dear Moments-','视觉小说','开发商','Frontwing']
];
for (const [kind,title,marker,role,creator] of cases) {
  test('模拟两阶段接口及字段出处 · ' + title, async () => {
    const quote = title + '是' + marker + '，' + role + '：' + creator + '。';
    const calls = [];
    const fetcher = async (url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer fixture-provider-key');
      assert.equal(init.redirect,'error');
      const body = JSON.parse(init.body);
      calls.push(url);
      if (url.endsWith('/web_search')) {
        assert.equal(body.search_engine,'search_pro');
        assert(body.search_query.endsWith(validateQuery({title,kind}).query.split(' ').slice(-1)[0]));
        assert.equal(body.count,8);
        return Response.json({search_result:[{link:resultUrl,title,content:quote,icon:'https://irrelevant.example/logo.png'}]});
      }
      assert.equal(body.model,'glm-4.7-flash');
      assert.equal(body.tools,undefined);
      assert(!JSON.stringify(body).includes('fixture-provider-key'));
      return Response.json({choices:[{message:{content:JSON.stringify({works:[{kind,title,identity:{ref:1,quote},
        fields:{creator:[{ref:1,quote,value:creator}],year:[{ref:1,quote,value:'2025'}]},
        cover_url:'https://unverified.example/img.jpg'}]})}}]});
    };
    const store = fixtureStore();
    const firstGateway = createGateway(env,store,{fetcher});
    const first = await firstGateway(request(kind,title));
    assert.equal(first.status,200);
    const result = await first.json();
    assert.equal(result.items.length,1);
    assert.equal(result.items[0].creator,creator);
    assert.equal(result.items[0].year,'');
    assert.equal(result.items[0].imageUrl,undefined);
    assert.equal(result.items[0].source.fields.creator.evidence[0].url,resultUrl);
    assert.equal(result.usage.searches,1);
    assert.equal(result.usage.extractions,1);
    assert.equal(result.usage.estimatedSearchYuan,0.03);
    const afterRestart = createGateway(env,store,{fetcher});
    const second = await (await afterRestart(request(kind,title))).json();
    assert(second.cached);
    assert.equal(calls.length,2);
    assert(!JSON.stringify(second).includes(token));
  });
}

test('源证据冲突留空，伪造的摘录和不安全链接均被拒绝', () => {
  const title = '样例电影';
  const pages = searchPages([
    {link:resultUrl,title,content:'样例电影由导演甲执导，上映年份2024。'},
    {link:'https://production.example/item',title,content:'样例电影导演乙，上映年份2025。'},
    {link:'javascript:alert(1)',title,content:'evil'},
    {link:'https://u:p@another.example/item',title,content:'evil'}
  ]);
  assert.equal(pages.length,2);
  const fields = {
    creator:[{ref:1,quote:'导演甲',value:'甲'},{ref:2,quote:'导演乙',value:'乙'}],
    year:[{ref:1,quote:'上映年份2024',value:'2024'},{ref:2,quote:'上映年份2025',value:'2025'}],
    country:[{ref:1,quote:'捏造制片国家',value:'国家'}]
  };
  const candidate = {title,kind:'film',identity:{ref:1,quote:'样例电影由导演甲执导'},fields};
  const [result] = groundedCandidates({works:[candidate,candidate,{...candidate,kind:'series'}]},pages,{kind:'film',title});
  assert.equal(result.creator,'');
  assert.equal(result.year,'');
  assert.equal(result.country,'');
  assert.deepEqual(result.source.conflicts.year.map(x=>x.value),['2024','2025']);
  assert.equal(groundedCandidates({works:[candidate,candidate]},pages,{kind:'film',title}).length,1);
});

test('鉴权、来源和持久额度在上游前校验，失败尝试也计入额度', async () => {
  let time = Date.parse('2026-11-09T01:00:00Z');
  let calls = 0;
  const store=fixtureStore();
  const opts = {now:()=>time,fetcher:async()=>{calls++;return Response.json({error:{code:'1113'}},{status:400});}};
  const settings={...env,GLM_DAILY_LIMIT:'1',GLM_MONTHLY_LIMIT:'1'};
  let gateway=createGateway(settings,store,opts);
  const badOrigin=await gateway(request('film','样例',{Origin:'https://other.example'}));
  assert.equal(badOrigin.status,403);
  assert.equal(badOrigin.headers.get('Access-Control-Allow-Origin'),null);
  assert.equal((await gateway(request('film','样例',{Authorization:'Bearer invalid'}))).status,401);
  assert.equal((await gateway(request('film','过'.repeat(2500)))).status,413);
  assert.equal(calls,0);
  assert.equal((await gateway(request('film','样例'))).status,402);
  assert.equal(calls,1);
  time+=86400000;
  gateway=createGateway(settings,store,opts);
  assert.equal((await gateway(request('film','新标题'))).status,429);
  const status=await (await gateway(new Request(testUrl+'/status',{headers:{Authorization:'Bearer '+token}}))).json();
  assert.equal(status.usage.searches,1);
  assert.equal(status.usage.failures,1);
  assert.equal(status.usage.today,0);
});

test('相同并发搜索复用一次上游请求，整理失败仍保留真实网页', async () => {
  let calls = 0;
  const store=fixtureStore();
  const gateway = createGateway(env,store,{fetcher:async url=>{
    calls++;
    await new Promise(resolve=>setTimeout(resolve,15));
    return url.endsWith('/web_search')?Response.json({search_result:[{link:resultUrl,title:'样例电影',content:'样例电影原文'}]})
      :Response.json({choices:[{message:{content:'无效 JSON'}}]});
  }});
  const results = await Promise.all([gateway(request('film','样例电影')),gateway(request('film','样例电影'))]);
  for (const response of results) {
    const data=await response.json();
    assert.equal(data.pages.length,1);
    assert.deepEqual(data.items,[]);
    assert(data.extractionError);
  }
  assert.equal(calls,2);
});

test('搜索格式错误或未带可追溯网页时不调用整理模型', async () => {
  for (const payload of [{foo:[]},{search_result:[{title:'网页',content:'内容',link:''}]}]) {
    let calls=0;
    const gateway=createGateway(env,fixtureStore(),{fetcher:async()=>{calls++;return Response.json(payload);}});
    const response=await gateway(request('book','示例'));
    assert.equal(calls,1);
    const data=await response.json();
    assert(payload.foo?data.error: data.items.length===0&&data.pages.length===0);
  }
});

test('前端拒绝代理 URL 凭证和非 HTTPS 公网地址',()=>{
  assert.equal(proxyEndpoint('https://x.account.workers.dev'),'https://x.account.workers.dev/v1');
  assert.equal(proxyEndpoint('', 'http://localhost:4173'),'http://localhost:4173/v1');
  for(const url of ['http://x.workers.dev','https://x.workers.dev.evil.com','https://a:b@x.workers.dev','https://x.workers.dev?token=x','https://x.workers.dev/else'])assert.throws(()=>proxyEndpoint(url));
});

test('GLM 失败不阻断结构化来源，结构化模式不会调用 GLM',async()=>{
  const structured={id:'1',title:'样例',source:{provider:'测试目录',url:resultUrl}};
  const options={provider:'auto',includeGlm:true,kind:'film',scope:'general',offline:false,
    cache:{get:()=>null,put(){}},runner:async()=>[structured]};
  const result=await searchLibrary('movie','样例',options,async()=>{throw Error('代理超时');});
  assert.deepEqual(result.items,[structured]);
  assert(result.attempts.some(x=>x.source==='glm'&&x.state==='error'));
  const database=await searchLibrary('movie','样例',{...options,provider:'structured'},async()=>assert.fail('unexpected GLM'));
  assert.deepEqual(database.items,[structured]);
});

test('综合结果保留数据库与网页不同版本，GLM 可单独使用',async()=>{
  const db={id:'a',title:'样例',source:{provider:'DB',url:resultUrl}};
  const web={id:'b',title:'样例',source:{provider:'GLM',url:'https://web.example/edition'}};
  const glm=async()=>({items:[web],pages:[]});
  const options={provider:'auto',includeGlm:true,kind:'film',scope:'general',offline:false,
    cache:{get:()=>null,put(){}},runner:async()=>[db]};
  assert.deepEqual(new Set((await searchLibrary('movie','样例',options,glm)).items),new Set([db,web]));
  assert.deepEqual((await searchLibrary('movie','样例',{...options,provider:'glm'},glm)).items,[web]);
});
