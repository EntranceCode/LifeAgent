import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,addExperiment,reviewExperiment,makeMemory,validateState,trashItem,restoreItem,visibleItems} from '../model.js';

function fixture(){
  const state=initialState();
  state.problems=[{id:'p',text:'想了解职业日常',workaround:'看访谈',createdAt:'2026-10-07'}];
  state.notes=[{id:'n',text:'今天听了一个访谈',date:'2026-10-07',directionId:null,sessionId:null,createdAt:'2026-10-07T08:00:00Z',updatedAt:'2026-10-07T08:00:00Z'}];
  return state;
}
const experiment=state=>({id:'e',directionId:state.directions[0].id,title:'聊聊工作日',hypothesis:'我是否喜欢这个过程？',budget:null,status:'active',createdAt:'2026-10-07',nextAction:'约一次聊天',completion:'记下一个喜欢的环节'});

test('新建实验并整理随手记一次完成，保留真实日期和原文，不填虚假评分',()=>{
  const state=fixture(),before=structuredClone(state);
  const next=addExperiment(state,experiment(state),{noteId:'n'});
  assert.equal(next.experiments.length,1);
  assert.equal(next.sessions.length,1);
  assert.equal(next.notes[0].sessionId,next.sessions[0].id);
  assert.equal(next.sessions[0].action,before.notes[0].text);
  assert.equal(next.sessions[0].date,'2026-10-07');
  assert.equal(next.sessions[0].minutes,null);
  assert.equal(next.sessions[0].again,null);
  assert.equal(next.notes[0].text,before.notes[0].text);
  assert.deepEqual(state,before);
  const beforeRepeat=structuredClone(next);
  assert.throws(()=>addExperiment(next,{...experiment(next),id:'second'},{noteId:'n'}),/已经整理/);
  assert.deepEqual(next,beforeRepeat,'A failed repeat must not create a second experiment.');
});
test('失效来源或无效实验不能部分创建方向、实验或探索记录',()=>{
  const state=fixture(),before=structuredClone(state);
  for(const options of [{noteId:'missing'},{problemId:'missing'}])assert.throws(()=>addExperiment(state,experiment(state),options));
  assert.throws(()=>addExperiment(state,{...experiment(state),directionId:'missing'},{noteId:'n'}));
  assert.throws(()=>addExperiment(trashItem(state,'notes','n'),experiment(state),{noteId:'n'}));
  assert.throws(()=>addExperiment(trashItem(state,'problems','p'),experiment(state),{problemId:'p'}));
  assert.deepEqual(state,before);
});
test('来源问题可对应多个实验，移除与恢复来源不隐藏实验或改写历史',()=>{
  const state=fixture();
  const first=addExperiment(state,experiment(state),{problemId:'p'});
  const second=addExperiment(first,{...experiment(first),id:'another'},{problemId:'p'});
  assert.equal(second.problems.length,1);
  assert.ok(second.experiments.every(e=>e.sourceProblemId==='p'));
  const deleted=trashItem(second,'problems','p');
  validateState(deleted);
  assert.equal(visibleItems(deleted,'experiments').length,2);
  assert.deepEqual(restoreItem(deleted,'problems','p'),second);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(deleted))),deleted);
});
test('复盘原子更新状态和下一步，问题与完成标准保留为独立快照',()=>{
  const original=fixture(),state=addExperiment(original,experiment(original),{noteId:'n'});
  const before=structuredClone(state);
  const reviewed=reviewExperiment(state,'e','active','聊天过程有意思','  下次再试一次实际任务  ');
  assert.deepEqual(state,before);
  const memory=structuredClone(reviewed.memories[0]);
  assert.equal(reviewed.experiments[0].nextAction,'下次再试一次实际任务');
  assert.equal(memory.nextAction,'下次再试一次实际任务');
  assert.equal(memory.hypothesis,state.experiments[0].hypothesis);
  assert.equal(memory.completion,state.experiments[0].completion);
  reviewed.experiments[0].hypothesis='另一个问题';
  reviewed.experiments[0].completion='另一个标准';
  reviewed.sessions[0].action='后来补充的文字';
  assert.deepEqual(reviewed.memories[0],memory);
  const held=reviewExperiment(reviewed,'e','hold','先休息一下','');
  assert.equal(held.experiments[0].status,'hold');
  assert.equal(held.experiments[0].nextAction,'');
  assert.equal(held.memories.length,2);
  assert.deepEqual(held.memories[0],memory);
  validateState(held);
});
test('旧字段仍可复盘；没有真实记录或无效复盘内容不会更新实验',()=>{
  const original=fixture(),fields=experiment(original);
  delete fields.nextAction;delete fields.completion;
  const state=addExperiment(original,fields,{noteId:'n'});
  assert.equal(makeMemory(state,'e','hold','先停一停').completion,'');
  const before=structuredClone(state);
  for(const [decision,reflection,nextAction] of [['invalid','复盘',''],['active','  ',''],['active','复盘',null],['active','复盘','x'.repeat(20001)]]){
    assert.throws(()=>reviewExperiment(state,'e',decision,reflection,nextAction));
  }
  assert.throws(()=>reviewExperiment({...state,sessions:[]},'e','active','尚未尝试'));
  assert.throws(()=>reviewExperiment(trashItem(state,'experiments','e'),'e','active','已删除'));
  assert.deepEqual(state,before);
});
test('新增可选字段严格校验，旧备份读取不会补写字段',()=>{
  const original=fixture(),fields=experiment(original);
  delete fields.nextAction;delete fields.completion;
  const legacy=addExperiment(original,fields,{noteId:'n'}),before=structuredClone(legacy);
  assert.deepEqual(validateState(legacy),before);
  assert.ok(!Object.hasOwn(legacy.experiments[0],'completion'));
  for(const key of ['nextAction','completion'])for(const value of [null,{},'x'.repeat(20001)]){
    const invalid=structuredClone(legacy);invalid.experiments[0][key]=value;assert.throws(()=>validateState(invalid));
  }
  const reviewed=reviewExperiment(legacy,'e','active','继续');
  for(const key of ['hypothesis','completion','nextAction']){
    const invalid=structuredClone(reviewed);invalid.memories[0][key]=42;assert.throws(()=>validateState(invalid));
  }
  const invalid=structuredClone(legacy);invalid.experiments[0].sourceProblemId='missing';assert.throws(()=>validateState(invalid));
});
