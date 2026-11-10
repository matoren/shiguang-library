// Rules are pure and versioned. Never infer selections from a historical score.
export const CHECKLIST_VERSION=1;
export function dimensionScore(state,options){
 if(!state||state.status!=='rated')return null;
 if(!Array.isArray(state.selected)||state.selected.length>10||new Set(state.selected).size!==state.selected.length)throw Error('每个维度最多选择10个不同选项');
 const selected=state.selected.map(id=>{const o=options.find(o=>o.id===id);if(!o||!Number.isFinite(o.delta))throw Error('未知评分选项');return o;});
 if(selected.some(o=>(o.excludes||[]).some(id=>state.selected.includes(id))))throw Error('所选评价存在直接矛盾');
 return Math.round(Math.max(0,Math.min(10,6+selected.reduce((sum,o)=>sum+o.delta,0)))*10)/10;
}
export function createChecklist(banks,weights){
 return {version:CHECKLIST_VERSION,banks:structuredClone(banks),dimensions:banks.map(()=>({status:'unrated',selected:[]})),weights:[...weights]};
}
export function beginChecklist(record,banks){
 const next=structuredClone(record);const keys=['scores','weights','computed','final','manual','adjusted','quick','mode','ruleVersion','checklist'];
 const hadInput=record.scores.some(v=>v!==null)||record.quick!==null||record.adjusted;next.ratingHistory=[...(next.ratingHistory||[]),...(hadInput?[{at:new Date().toISOString(),snapshot:Object.fromEntries(keys.filter(k=>Object.hasOwn(record,k)).map(k=>[k,structuredClone(record[k])]))}]:[])];
 next.checklist=createChecklist(banks,record.weights);
 next.scores=banks.map(()=>null);next.computed=null;next.adjusted=false;next.manual=null;if(next.mode!=='quick')next.final=null;return next;
}

function validateHistory(r){const fail=()=>{throw Error('评分历史格式不正确');};
 if(r.ratingHistory!==undefined&&(!Array.isArray(r.ratingHistory)||r.ratingHistory.length>1000))fail();for(const h of r.ratingHistory||[]){if(!h||typeof h.at!=='string'||!h.snapshot||!Array.isArray(h.snapshot.scores)||!h.snapshot.scores.every(v=>v===null||(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=10))||!['standard','quick'].includes(h.snapshot.mode)||!(h.snapshot.final===null||(typeof h.snapshot.final==='number'&&Number.isFinite(h.snapshot.final)&&h.snapshot.final>=0&&h.snapshot.final<=10)))fail();}
}
export function validateChecklist(r){validateHistory(r);
 const c=r.checklist;if(!c)return;
 const fail=()=>{throw Error('勾选评分记录或规则快照不正确');};
 if(c.version!==1||!Array.isArray(c.banks)||c.banks.length!==r.scores.length||!Array.isArray(c.dimensions)||c.dimensions.length!==r.scores.length||JSON.stringify(c.weights)!==JSON.stringify(r.weights))fail();
 c.banks.forEach((bank,i)=>{if(!Array.isArray(bank)||bank.length<16||bank.length>20||new Set(bank.map(o=>o.id)).size!==bank.length)fail();for(const o of bank)if(typeof o.id!=='string'||typeof o.label!=='string'||o.label.length>200||!Number.isFinite(o.delta)||o.delta===0||Math.abs(o.delta)>1.2||!Array.isArray(o.excludes)||o.excludes.some(id=>!bank.some(x=>x.id===id)))fail();const state=c.dimensions[i];if(!state||!['unrated','rated','na'].includes(state.status)||!Array.isArray(state.selected)||state.selected.length>10||state.selected.some(id=>!bank.some(o=>o.id===id)))fail();if(dimensionScore(state,bank)!==r.scores[i])fail();});

}

export function archiveSavedRating(next,previous){
 if(!previous)return next;
 const keys=['scores','weights','computed','final','manual','adjusted','quick','mode','ruleVersion','checklist'];
 const snapshot=r=>Object.fromEntries(keys.filter(k=>Object.hasOwn(r,k)).map(k=>[k,structuredClone(r[k])]));const old=snapshot(previous);
 if(JSON.stringify(snapshot(next))===JSON.stringify(old)||(next.ratingHistory||[]).some(h=>JSON.stringify(h.snapshot)===JSON.stringify(old)))return next;
 return {...next,ratingHistory:[...(next.ratingHistory||[]),{at:new Date().toISOString(),snapshot:old}]};
}
