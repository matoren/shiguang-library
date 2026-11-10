import test from 'node:test';
import assert from 'node:assert/strict';
import {backup,calculate,CATEGORIES,defaults,MOVIE_WEIGHTS,ratingMethod,switchRatingMethod,validateBackup,archiveAlternateRating} from '../core.js';
import {dimensionScore,archiveSavedRating} from '../checklist.js';
import {bankKey,optionsFor} from '../rating-options.js';

function legacy(type='book'){
 const settings=defaults(), weights=type==='book'?settings.weights[0]:MOVIE_WEIGHTS;
 const scores=[8.5,0,...weights.slice(2).map(()=>null)];
 const at='2026-11-10T00:00:00.000Z';
 return {id:type,type,title:'旧收藏',category:type==='book'?CATEGORIES[0]:'',creator:'',tags:[],
  weights,scores,computed:calculate(scores,weights),manual:8.3,adjusted:true,final:8.3,quick:type==='book'?null:9.1,
  mode:'standard',ruleVersion:1,status:type==='book'?'已读':'已看',date:'',comment:'旧评论',cover:null,thumb:null,created:at,updated:at};
}
const toggle=(record,method)=>switchRatingMethod(record,method,method==='checklist'?optionsFor(record):null,bankKey(record));
const roundTrip=record=>validateBackup(backup([record],defaults())).records[0];
function markChecklist(record){
 const state=record.checklist.dimensions[0], bank=record.checklist.banks[0];
 state.status='rated';state.selected=[bank[0].id];
 record.scores[0]=dimensionScore(state,bank);
 record.computed=calculate(record.scores,record.weights);record.final=record.computed;
 return record;
}
test('旧逐项评分原样打开，两种方式各自保留勾选、零分、手调和规则快照',()=>{
 const previous=roundTrip(legacy());
 assert.equal(ratingMethod(previous),'numeric');
 const checked=markChecklist(toggle(previous,'checklist'));
 assert.equal(checked.standardAlternate.rating.scores[1],0);
 const saved=roundTrip(archiveSavedRating(checked,previous));
 assert.equal(saved.ratingHistory[0].snapshot.final,8.3);
 const numeric=roundTrip(toggle(saved,'numeric'));
 assert.deepEqual(numeric.scores,previous.scores);
 assert.equal(numeric.final,8.3);
 assert.equal(numeric.comment,'旧评论');
 const reopened=roundTrip(toggle(numeric,'checklist'));
 assert.deepEqual(reopened.checklist,saved.checklist);
 assert.equal(reopened.final,saved.final);
});
test('电影快速分和两种维度分互相独立',()=>{
 const prior=legacy('movie');
 const checked=roundTrip(markChecklist(toggle(prior,'checklist')));
 const quick=roundTrip(toggle(checked,'quick'));
 assert.equal(quick.final,9.1);
 assert.equal(ratingMethod(quick),'quick');
 assert.equal(roundTrip(toggle(quick,'numeric')).final,8.3);
 assert.equal(roundTrip(toggle(quick,'checklist')).final,checked.final);
});
test('作品上下文改变前，备用评分连同勾选规则存入历史',()=>{
 const book=legacy();
 const checked=markChecklist(toggle(book,'checklist'));
 const numeric=toggle(checked,'numeric');
 const changed=archiveAlternateRating(numeric);
 changed.category=CATEGORIES[1];
 assert.equal(changed.standardAlternate,undefined);
 assert.deepEqual(changed.ratingHistory[0].snapshot.checklist,checked.checklist);
 assert.deepEqual(roundTrip(changed).scores,book.scores);
});
