import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,validateState,attachNote,trashItem,restoreItem,visibleItems} from '../model.js';
import {guidePool,sampleDirections} from '../guides.js';
const note=()=>({id:'note-1',text:'听到一个有意思的职业故事',date:'2026-10-06',directionId:null,sessionId:null,createdAt:'2026-10-06T10:00:00Z',updatedAt:'2026-10-06T10:00:00Z'});
test('旧备份可直接读取，随手记不需要方向或实验',()=>{
  const state=initialState();
  delete state.notes;
  const original=structuredClone(state);
  assert.deepEqual(validateState(state),original);
  assert.deepEqual(visibleItems(state,'notes'),[]);
  state.notes=[note()];
  validateState(state);
  assert.equal(visibleItems(state,'notes').length,1);
  assert.equal(visibleItems(trashItem(state,'notes','note-1'),'notes').length,0);
  assert.deepEqual(restoreItem(trashItem(state,'notes','note-1'),'notes','note-1'),state);
});
test('随手记整理原子创建记录，保留原文并阻止重复整理',()=>{
  const state=initialState();
  state.notes=[note()];
  state.experiments=[{id:'e',directionId:state.directions[0].id,title:'职业试水',hypothesis:'',budget:null,status:'active',createdAt:'2026-10-06'}];
  const result=attachNote(state,'note-1','e');
  validateState(result);
  assert.equal(state.sessions.length,0);
  assert.equal(result.notes[0].text,state.notes[0].text);
  assert.equal(result.sessions[0].action,state.notes[0].text);
  assert.equal(result.sessions[0].minutes,null);
  assert.equal(result.sessions[0].again,null);
  assert.equal(result.notes[0].sessionId,result.sessions[0].id);
  assert.throws(()=>attachNote(result,'note-1','e'));
  assert.throws(()=>attachNote(state,'note-1','missing'));
  assert.throws(()=>attachNote(trashItem(state,'notes','note-1'),'note-1','e'));
});
test('随手记关联和反馈在导入时校验',()=>{
  const state=initialState();
  state.notes=[note()];
  state.notes[0].sessionId='missing';
  assert.throws(()=>validateState(state));
  state.notes[0].sessionId=null;
  state.guideFeedback=[{guideKey:'生活|15|make|0',value:'later',createdAt:'2026-10-06T10:00:00Z'}];
  validateState(state);
  state.guideFeedback.push({...state.guideFeedback[0]});
  assert.throws(()=>validateState(state));
});
test('方向改变具体步骤；时间、接触方式与自定义方向均有效',()=>{
  const product=guidePool('产品设计','15','make');
  const writing=guidePool('写作','15','make');
  assert.notDeepEqual(product[0].steps,writing[0].steps);
  assert.match(writing[0].steps[0],/150 字/);
  assert.match(guidePool('摄影','15','make')[0].steps[0],/照片/);
  assert.match(guidePool('园艺','15','make')[0].steps[0],/园艺/);
  for(const name of [...sampleDirections,'产品设计','AI 产品','写作','视频创作','技术服务','科研','园艺']){
    for(const mode of ['discover','talk','make'])for(const minutes of ['15','60','180']){
      const pool=guidePool(name,minutes,mode);
      assert.equal(new Set(pool.map(item=>item.guideKey)).size,pool.length);
      assert.ok(pool.every(item=>item.steps.length>=3&&item.completion));
    }
  }
});
