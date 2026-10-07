import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,trashItem,attachNote,validateState} from '../model.js';
import {journalEntries} from '../journal.js';

function fixture(){
  const state=initialState(),directionId=state.directions[0].id;
  state.experiments=[{id:'e',directionId,title:'Notebook <笔记>',hypothesis:'',budget:null,status:'archived',createdAt:'2026-10-01'}];
  state.sessions=[{id:'s',experimentId:'e',date:'2026-10-07T23:00:00Z',action:'画流程',insight:'可以继续',minutes:null,feeling:null,achievement:null,again:null,skills:['访谈']}];
  state.notes=[{id:'n',text:'看展后的好奇',date:'2026-10-06',directionId,sessionId:null,createdAt:'2026-10-06T08:00:00Z',updatedAt:'2026-10-06T08:00:00Z'},
    {id:'free',text:'没有方向也可以记',date:'2026-10-05',directionId:null,sessionId:null,createdAt:'2026-10-05T08:00:00Z',updatedAt:'2026-10-05T08:00:00Z'}];
  validateState(state);return state;
}
test('手记组合筛选，日期边界含当天，支持旧版时间戳',()=>{
  const state=fixture(),before=structuredClone(state);
  const ids=filters=>journalEntries(state,filters).map(entry=>entry.item.id);
  assert.deepEqual(ids({}),['s','n','free']);
  assert.deepEqual(ids({from:'2026-10-06',to:'2026-10-07'}),['s','n']);
  assert.deepEqual(ids({from:'2026-10-07',to:'2026-10-07'}),['s']);
  assert.deepEqual(ids({kind:'note',directionId:state.directions[0].id,from:'2026-10-06',to:'2026-10-06',query:'好奇'}),['n']);
  assert.deepEqual(ids({from:'2026-10-08',to:'2026-10-07'}),[]);
  assert.deepEqual(ids({from:'2026-10-06'}),['s','n']);
  assert.deepEqual(ids({to:'2026-10-06'}),['n','free']);
  assert.deepEqual(state,before,'Searching does not change records or backup format.');
});
test('检索包含实验标题、方向、发现与技能；英文忽略大小写和首尾空格',()=>{
  const state=fixture();
  for(const query of [' notebook ','访谈','可以继续','产品设计'])assert.ok(journalEntries(state,{query}).some(entry=>entry.item.id==='s'));
  assert.deepEqual(journalEntries(state,{query:'缺失词'}),[]);
});
test('尚未整理只显示未关联的随手记；隐藏父实验和回收站记录不参与检索',()=>{
  const state=attachNote(fixture(),'n','e');
  assert.deepEqual(journalEntries(state,{kind:'unfiled'}).map(entry=>entry.item.id),['free']);
  const removed=trashItem(state,'experiments','e');
  assert.ok(journalEntries(removed).every(entry=>entry.kind==='note'));
  assert.equal(journalEntries(trashItem(removed,'notes','free')).length,1);
  assert.equal(journalEntries(trashItem(state,'sessions','s'),{kind:'session'}).length,1);
  delete removed.notes;
  assert.deepEqual(journalEntries(removed),[],'Old backups without notes remain usable.');
});
