import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, validateState, summarize, makeMemory, visibleItems, trashItems, trashItem, restoreItem } from '../model.js';
function fixture(){const s=initialState();s.experiments.push({id:'e',directionId:s.directions[0].id,title:'尝试',hypothesis:'假设',budget:null,status:'active',createdAt:new Date().toISOString()});s.sessions.push({id:'s',experimentId:'e',date:'2026-09-09',action:'画了一张流程图',minutes:null,feeling:null,achievement:4,again:5,insight:'喜欢画流程',skills:['原型']});return s;}
test('JSON 备份可往返，保留未知时长和评分',()=>{const s=fixture();assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))),s);assert.deepEqual(summarize(s.sessions),{count:1,minutes:0,timed:0,insights:['喜欢画流程']});});
test('拒绝缺失关联和错误评分',()=>{const s=fixture();s.sessions[0].experimentId='missing';assert.throws(()=>validateState(s));s.sessions[0].experimentId='e';s.sessions[0].feeling=6;assert.throws(()=>validateState(s));});
test('拒绝重复 ID、未知状态和恶意属性名',()=>{const s=fixture();s.experiments[0].status='toString';assert.throws(()=>validateState(s));s.experiments[0].status='active';s.sessions.push({...s.sessions[0]});assert.throws(()=>validateState(s));});
test('归档记忆为独立快照，后续修改和新记录不改变它',()=>{const s=fixture();const m=makeMemory(s,'e','archived','先放下，也留下了发现');s.memories.push(m);s.sessions[0].insight='新的想法';s.sessions[0].skills.push('观察');s.sessions.push({...s.sessions[0],id:'s2'});assert.equal(m.sessions.length,1);assert.equal(m.sessions[0].insight,'喜欢画流程');assert.deepEqual(m.sessions[0].skills,['原型']);validateState(s);});
test('无行动记录不能生成记忆',()=>{const s=fixture();s.sessions=[];assert.throws(()=>makeMemory(s,'e','active','想继续'));});

test('旧版备份无需迁移，删除后的备份仍使用 version 1 并保留所有数据',()=>{
  const original=fixture();
  original.experiments[0].createdAt='2026-09-09';
  assert.deepEqual(trashItems(original),[]);
  assert.deepEqual(visibleItems(original,'experiments'),original.experiments);
  const deleted=trashItem(original,'experiments','e');
  const restoredBackup=validateState(JSON.parse(JSON.stringify(deleted)));
  assert.equal(restoredBackup.version,1);
  assert.equal(restoredBackup.experiments.length,1);
  assert.equal(restoredBackup.sessions.length,1);
  assert.equal(restoredBackup.sessions[0].feeling,null);
  assert.equal(original.experiments[0].deletedAt,undefined);
  assert.deepEqual(restoreItem(restoredBackup,'experiments','e'),original);
});

test('实验删除隐藏关联记录与记忆，只在回收站显示实验且不影响其他实验',()=>{
  const original=fixture();
  const memory=makeMemory(original,'e','hold','暂时放下');
  original.memories.push(memory);
  original.experiments.push({...original.experiments[0],id:'other',directionId:original.directions[1].id});
  original.sessions.push({...original.sessions[0],id:'other-session',experimentId:'other'});
  const otherMemory=makeMemory(original,'other','active','继续尝试');
  original.memories.push(otherMemory);
  const snapshot=structuredClone(original);
  const deleted=trashItem(original,'experiments','e');
  assert.deepEqual(original,snapshot);
  assert.equal(deleted.sessions,original.sessions);
  assert.equal(deleted.memories,original.memories);
  assert.deepEqual(visibleItems(deleted,'experiments').map(item=>item.id),['other']);
  assert.deepEqual(visibleItems(deleted,'sessions').map(item=>item.id),['other-session']);
  assert.deepEqual(visibleItems(deleted,'memories').map(item=>item.id),[otherMemory.id]);
  assert.deepEqual(trashItems(deleted).map(({collection,item})=>[collection,item.id]),[['experiments','e']]);
  assert.deepEqual(restoreItem(deleted,'experiments','e'),original);
  assert.deepEqual(memory,snapshot.memories[0]);
});

test('恢复实验不恢复已单独删除的记录，恢复记录可同时恢复其实验',()=>{
  const original=fixture();
  const sessionDeleted=trashItem(original,'sessions','s');
  const bothDeleted=trashItem(sessionDeleted,'experiments','e');
  const parentRestored=restoreItem(bothDeleted,'experiments','e');
  assert.equal(visibleItems(parentRestored,'experiments').length,1);
  assert.equal(visibleItems(parentRestored,'sessions').length,0);
  assert.equal(trashItems(parentRestored)[0].item.id,'s');
  const childRestored=restoreItem(bothDeleted,'sessions','s');
  assert.deepEqual(childRestored,original);
  assert.equal(visibleItems(bothDeleted,'sessions').length,0);
});

test('从备份恢复记忆时恢复被删除的祖先，保留其他删除项和历史快照',()=>{
  const original=fixture();
  const memory=makeMemory(original,'e','hold','也有收获');
  original.memories.push(memory);
  original.sessions.push({...original.sessions[0],id:'individually-deleted'});
  let deleted=trashItem(original,'sessions','individually-deleted');
  deleted=trashItem(deleted,'memories',memory.id);
  deleted=trashItem(deleted,'experiments','e');
  // Imported backups may already contain a deleted ancestor.
  deleted={...deleted,directions:deleted.directions.map((item,index)=>index===0?{...item,deletedAt:'2026-09-15T01:02:03.000Z'}:item)};
  validateState(deleted);
  const before=structuredClone(deleted);
  assert.equal(visibleItems(deleted,'experiments').length,0);
  const restored=restoreItem(deleted,'memories',memory.id);
  assert.deepEqual(deleted,before);
  assert.equal(visibleItems(restored,'directions').length,original.directions.length);
  assert.equal(visibleItems(restored,'experiments').length,1);
  assert.deepEqual(visibleItems(restored,'sessions').map(item=>item.id),['s']);
  assert.deepEqual(visibleItems(restored,'memories'),[memory]);
  assert.deepEqual(trashItems(restored).map(({item})=>item.id),['individually-deleted']);
  validateState(restored);
});

test('空方向可删除恢复，仍有关联实验的方向不能删除',()=>{
  const original=fixture();
  const emptyId=original.directions[1].id;
  const deleted=trashItem(original,'directions',emptyId);
  assert.equal(visibleItems(deleted,'directions').length,original.directions.length-1);
  assert.deepEqual(restoreItem(deleted,'directions',emptyId),original);
  assert.throws(()=>trashItem(original,'directions',original.directions[0].id),/还有实验/);
  const experimentDeleted=trashItem(original,'experiments','e');
  assert.throws(()=>trashItem(experimentDeleted,'directions',original.directions[0].id),/还有实验/);
});

test('删除原始记录不改变已有记忆，新记忆只快照可见记录并保留未知评分',()=>{
  const original=fixture();
  const memory=makeMemory(original,'e','active','保持好奇');
  original.memories.push(memory);
  original.sessions.push({...original.sessions[0],id:'new-session',achievement:null,skills:['写作']});
  const deleted=trashItem(original,'sessions','s');
  assert.deepEqual(visibleItems(deleted,'memories'),[memory]);
  assert.equal(memory.sessions[0].id,'s');
  const latest=makeMemory(deleted,'e','hold','只保留这次复盘可见的记录');
  assert.deepEqual(latest.sessions.map(item=>item.id),['new-session']);
  assert.equal(latest.sessions[0].feeling,null);
  assert.equal(latest.sessions[0].achievement,null);
  assert.equal(latest.sessions[0].minutes,null);
  deleted.sessions[1].skills.push('观察');
  assert.deepEqual(latest.sessions[0].skills,['写作']);
  const allSessionsDeleted=trashItem(deleted,'sessions','new-session');
  assert.throws(()=>makeMemory(allSessionsDeleted,'e','active','再试试'),/先留下/);
  assert.throws(()=>makeMemory(trashItem(original,'experiments','e'),'e','active','再试试'));
});

test('问题和记忆可独立删除恢复，重复删除保留原删除时间',()=>{
  const original=fixture();
  const memory=makeMemory(original,'e','active','收获');
  original.memories.push(memory);
  original.problems.push({id:'problem',text:'如何表达我的想法？',workaround:'',createdAt:'2026-09-15T09:00:00.000Z'});
  const deleted=trashItem(trashItem(original,'problems','problem'),'memories',memory.id);
  assert.equal(visibleItems(deleted,'problems').length,0);
  assert.equal(visibleItems(deleted,'memories').length,0);
  assert.equal(visibleItems(deleted,'experiments').length,1);
  assert.equal(visibleItems(deleted,'sessions').length,1);
  assert.deepEqual(trashItem(deleted,'problems','problem'),deleted);
  const restored=restoreItem(restoreItem(deleted,'problems','problem'),'memories',memory.id);
  assert.deepEqual(restored,original);
  assert.equal(Object.hasOwn(restored.problems[0],'deletedAt'),false);
});

test('拒绝未知集合与缺失记录，错误操作不改变输入',()=>{
  const original=fixture();
  const before=structuredClone(original);
  for(const collection of ['missing','__proto__','toString']) {
    assert.throws(()=>visibleItems(original,collection));
    assert.throws(()=>trashItem(original,collection,'e'));
    assert.throws(()=>restoreItem(original,collection,'e'));
  }
  assert.throws(()=>trashItem(original,'experiments','missing'));
  assert.throws(()=>restoreItem(original,'sessions','missing'));
  assert.deepEqual(original,before);
});

test('日期验证拒绝自动滚动的日期和含糊格式，接受闰日及标准 ISO 时间戳',()=>{
  for(const invalid of ['2026-02-29','2026-02-30','2026-04-31','2026-13-01','2026-00-10','2026-01-00','09/15/2026','15','2026-09-15T24:00:00Z','2026-09-15T12:00:60Z']) {
    const state=fixture();
    state.sessions[0].date=invalid;
    assert.throws(()=>validateState(state),invalid);
  }
  for(const valid of ['2024-02-29','2000-02-29','2026-09-15','2026-09-15T09:00:00.123Z','2026-09-15T09:00:00+08:00']) {
    const state=fixture();
    state.sessions[0].date=valid;
    assert.equal(validateState(state),state);
  }
  const state=fixture();
  state.experiments[0].createdAt='2026-02-30T09:00:00.000Z';
  assert.throws(()=>validateState(state));
});

test('各类记录的 deletedAt 必须为有效 ISO 时间戳',()=>{
  const original=fixture();
  original.memories.push(makeMemory(original,'e','active','继续'));
  original.problems.push({id:'p',text:'一个问题',workaround:'',createdAt:'2026-09-15T00:00:00.000Z'});
  for(const collection of ['directions','experiments','sessions','memories','problems']) {
    for(const invalid of [null,undefined,'','2026-09-15','2026-02-30T00:00:00Z','2026-09-15T00:00:00+25:00',123]) {
      const state=structuredClone(original);
      state[collection][0].deletedAt=invalid;
      assert.throws(()=>validateState(state),`${collection}: ${invalid}`);
    }
    const state=structuredClone(original);
    state[collection][0].deletedAt='2026-09-15T00:00:00.000Z';
    validateState(state);
  }
});

test('拒绝重复快照 ID、不同实验的快照和空白必填内容',()=>{
  const original=fixture();
  original.memories.push(makeMemory(original,'e','active','继续'));
  const duplicate=structuredClone(original);
  duplicate.memories[0].sessions.push(structuredClone(duplicate.memories[0].sessions[0]));
  assert.throws(()=>validateState(duplicate));
  const wrongParent=structuredClone(original);
  wrongParent.experiments.push({...wrongParent.experiments[0],id:'other'});
  wrongParent.memories[0].sessions[0].experimentId='other';
  assert.throws(()=>validateState(wrongParent));
  for(const [collection,key] of [['directions','name'],['experiments','title'],['sessions','action'],['memories','reflection']]) {
    const state=structuredClone(original);
    state[collection][0][key]=' \n\t ';
    assert.throws(()=>validateState(state));
  }
  const badSkill=structuredClone(original);
  badSkill.sessions[0].skills=[' '];
  assert.throws(()=>validateState(badSkill));
  // A historical snapshot does not require a matching live record.
  const historical=structuredClone(original);
  historical.memories[0].sessions[0].id='past-session';
  validateState(historical);
});
