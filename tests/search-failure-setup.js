// Deliberate fault injection ONLY on tests/search-failure.html.
// Never imported by the production application or service worker asset list.
const realFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=(input,options)=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(['ndlsearch.ndl.go.jp','api.vndb.org','api.bgm.tv','www.wikidata.org','commons.wikimedia.org','openlibrary.org','api.tvmaze.com'].includes(url.hostname))return Promise.reject(new TypeError('Simulated network/CORS failure for UI regression testing'));
 return realFetch(input,options);
};
