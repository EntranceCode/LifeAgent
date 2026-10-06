// Optional: PLAYWRIGHT_MODULE points to an installed playwright/index.mjs.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const BASE_URL=process.env.EXPLOREOS_TEST_URL||'http://localhost:4173';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
  // A fresh browser context keeps smoke-test data away from the user's records.
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(10000);
  const errors=[];
  const unexpectedDialogs=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',async dialog=>{
    if(dialog.type()==='confirm') await dialog.accept();
    else {unexpectedDialogs.push(dialog.message());await dialog.dismiss();}
  });
  const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('exploreos.v1')));
  const navigate=async view=>{
    await page.locator(`[data-view="${view}"]:visible`).first().click();
    assert.equal(await page.locator(`[data-view="${view}"]`).first().getAttribute('aria-current'),'page');
  };
  const action=(name,id)=>page.locator(`[data-action="${name}"]${id?`[data-id="${id}"]`:''}`);
  const save=async()=>{
    await page.locator('#form').getByRole('button',{name:'保存',exact:true}).click();
    await page.locator('#dialog').waitFor({state:'hidden'});
  };
  const noOverflow=async label=>assert.equal(
    await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label
  );

  await page.goto(BASE_URL);
  const initialState=await state();
  await page.getByRole('button',{name:'✦ 带我去看看',exact:true}).click();
  assert.match(await page.locator('#content').innerText(),/不知道往哪走时，先走一小步/);
  assert.equal(await page.locator('[data-guide-pref]').count(),4);
  const firstGuideTitle=await page.locator('.guide-card h2').innerText();
  await action('guide-next').click();
  assert.notEqual(await page.locator('.guide-card h2').innerText(),firstGuideTitle);
  await page.locator('[data-guide-pref="energy"]').selectOption('low');
  await page.locator('[data-guide-pref="minutes"]').selectOption('15');
  await page.locator('[data-guide-pref="mode"]').selectOption('make');
  assert.match(await page.locator('.guide-outcomes').innerText(),/先做10分钟/);
  const guidedTitle=await page.locator('.guide-card h2').innerText();
  await action('guide-experiment').click();
  assert.equal(await page.locator('#f-title').inputValue(),guidedTitle);
  assert.equal(await page.locator('#f-budget').inputValue(),'0.25');
  assert.deepEqual(await state(),initialState,'Opening a guided experiment must not write data.');
  await page.locator('#discard-draft').click();
  await action('guide-problem').click();
  assert.match(await page.locator('#f-text').inputValue(),new RegExp(guidedTitle));
  assert.deepEqual(await state(),initialState,'Opening a guided question must not write data.');
  await page.locator('#discard-draft').click();
  await navigate('map');
  await page.getByRole('button',{name:'自己开始实验',exact:true}).click();
  await page.locator('#f-title').fill('设计一次真实体验');
  await page.locator('#f-hypothesis').fill('我是否喜欢梳理流程？');
  await save();
  const experimentId=(await state()).experiments[0].id;
  await page.waitForFunction(()=>fetch('/api/state').then(response=>response.json()).then(data=>data.latest?.state?.experiments?.length===1));

  await action('session',experimentId).click();
  const originalAction='画了一个流程 <script>alert(1)</script>';
  await page.locator('#f-action').fill(originalAction);
  await page.locator('#f-insight').fill('设计环节有意思，仍需再尝试。');
  assert.equal(await page.locator('details.optional-fields').getAttribute('open'),null);
  await page.locator('details.optional-fields > summary').click();
  await page.locator('#f-minutes').fill('30');
  await page.locator('#f-feeling').selectOption('4');
  await page.locator('#f-achievement').selectOption('3');
  await page.locator('#f-again').selectOption('5');
  await page.locator('#f-skills').fill('原型设计，原型设计');
  await save();
  const firstRecord=(await state()).sessions[0];
  assert.deepEqual(firstRecord.skills,['原型设计']);
  assert.equal(firstRecord.minutes,30);
  assert.equal(firstRecord.feeling,4);
  assert.equal(firstRecord.achievement,3);
  assert.equal(firstRecord.again,5);

  await page.reload();
  await navigate('journal');
  assert.match(await page.locator('#content').innerText(),/画了一个流程 <script>alert\(1\)<\/script>/);
  assert.equal(await page.locator('#content script').count(),0);
  await navigate('experiments');
  assert.match(await page.locator('#content').innerText(),/1 条记录/);
  await action('review',experimentId).click();
  assert.match(await page.locator('.review-stats').innerText(),/4\.0 \/ 5/);
  await page.locator('#f-reflection').fill('暂时放下，保留这次体验。');
  await page.locator('#f-decision').selectOption('archived');
  await save();
  const memorySnapshot=(await state()).memories[0];
  await navigate('memories');
  assert.match(await page.locator('#content').innerText(),/暂时放下，保留这次体验/);
  await navigate('skills');
  assert.match(await page.locator('#content').innerText(),/1\s*次接触/);

  // Editing a source record must never rewrite an existing memory snapshot.
  await navigate('journal');
  await action('edit-session',firstRecord.id).click();
  assert.equal(await page.locator('#f-action').inputValue(),originalAction);
  await page.locator('#f-action').fill('重新整理了流程，补上遗漏的反馈');
  await page.locator('#f-minutes').fill('45');
  await save();
  assert.equal((await state()).sessions[0].minutes,45);
  assert.deepEqual((await state()).memories[0],memorySnapshot);

  await navigate('experiments');
  await action('resume',experimentId).click();
  await action('session',experimentId).click();
  await page.locator('#f-action').fill('再次体验，草稿尚未完成');
  await page.locator('#f-insight').fill('关闭窗口以后还想继续补充。');
  await page.locator('details.optional-fields > summary').click();
  await page.locator('#f-minutes').fill('15');
  await page.locator('#close-dialog').click();
  await page.locator('#dialog').waitFor({state:'hidden'});
  assert.equal((await state()).sessions.length,1,'Closing a draft must not create a record.');
  await page.reload();
  await navigate('experiments');
  await action('session',experimentId).click();
  assert.equal(await page.locator('#f-action').inputValue(),'再次体验，草稿尚未完成');
  assert.equal(await page.locator('#f-minutes').inputValue(),'15');
  assert.match(await page.locator('#draft-status').innerText(),/已找回/);
  await page.locator('#f-action').fill('再次体验');
  await save();
  let saved=await state();
  assert.equal(saved.sessions.length,2);
  assert.deepEqual(saved.memories[0],memorySnapshot);
  assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('exploreos.drafts.v1'))).length),0);

  // A discarded draft is cleared without changing the last saved record.
  await navigate('journal');
  await action('edit-session',firstRecord.id).click();
  await page.locator('#f-action').fill('这条修改应该被丢弃');
  await page.locator('#discard-draft').click();
  await page.locator('#dialog').waitFor({state:'hidden'});
  assert.equal((await state()).sessions[0].action,'重新整理了流程，补上遗漏的反馈');
  await page.locator('#search').fill('再次体验');
  assert.equal(await page.locator('#content [data-record]').count(),1);
  await page.locator('#search').fill('不存在的探索关键词');
  assert.equal(await page.locator('#content [data-record]').count(),0);
  await page.locator('#search').fill('');

  await action('trash-sessions',firstRecord.id).click();
  assert.equal(await page.locator('#content [data-record]').count(),1);
  assert.ok((await state()).sessions.find(record=>record.id===firstRecord.id).deletedAt);
  assert.deepEqual((await state()).memories[0],memorySnapshot);
  await navigate('backup');
  assert.match(await page.locator('.disk-backup').innerText(),/本机自动备份/);
  await action('restore-sessions',firstRecord.id).click();
  await navigate('journal');
  assert.equal(await page.locator('#content [data-record]').count(),2);

  // Removing an experiment hides its children; restoring it reveals them intact.
  await navigate('experiments');
  await action('trash-experiments',experimentId).click();
  assert.equal(await page.locator('.experiment-card').count(),0);
  await navigate('journal');
  assert.equal(await page.locator('#content [data-record]').count(),0);
  await navigate('memories');
  assert.equal(await page.locator('.memory').count(),0);
  await navigate('backup');
  await action('restore-experiments',experimentId).click();
  await navigate('journal');
  assert.equal(await page.locator('#content [data-record]').count(),2);
  await navigate('memories');
  assert.equal(await page.locator('.memory').count(),1);
  assert.deepEqual((await state()).memories[0],memorySnapshot);

  await navigate('problems');
  await action('problem').click();
  await page.locator('#f-text').fill('每次不知道从哪里开始');
  await page.locator('#f-workaround').fill('暂时把想法随手写在纸上');
  await save();
  const problemId=(await state()).problems[0].id;
  await action('problem-experiment',problemId).click();
  assert.equal(await page.locator('#f-title').inputValue(),'每次不知道从哪里开始');
  assert.match(await page.locator('#f-hypothesis').inputValue(),/暂时把想法随手写在纸上/);
  await save();
  saved=await state();
  assert.equal(saved.experiments.length,2);
  assert.equal(saved.problems.length,1,'Turning a problem into an experiment preserves the original problem.');
  const secondExperimentId=saved.experiments.find(item=>item.id!==experimentId).id;
  await action('hold',secondExperimentId).click();
  await page.locator('#status-filter').selectOption('hold');
  assert.equal(await page.locator('.experiment-card').count(),1);
  assert.equal(await page.locator('.experiment-card').getAttribute('data-experiment'),secondExperimentId);
  await page.locator('#status-filter').selectOption('active');
  assert.equal(await page.locator('.experiment-card').getAttribute('data-experiment'),experimentId);
  await page.locator('#status-filter').selectOption('');
  await page.locator('#search').fill('反馈');
  assert.equal(await page.locator('.experiment-card').count(),1);
  assert.equal(await page.locator('.experiment-card').getAttribute('data-experiment'),experimentId);
  await page.locator('#search').fill('每次不知道');
  assert.equal(await page.locator('.experiment-card').getAttribute('data-experiment'),secondExperimentId);

  await navigate('backup');
  const backupState=await state();
  const downloadPromise=page.waitForEvent('download');
  await action('export').click();
  const download=await downloadPromise;
  assert.match(download.suggestedFilename(),/exploreos/);
  const backupPath=await download.path();
  const safetyCopyPromise=page.waitForEvent('download');
  await page.locator('#import-file').setInputFiles(backupPath);
  await page.waitForFunction(()=>document.querySelector('#notice').textContent==='备份已恢复。');
  assert.match((await safetyCopyPromise).suggestedFilename(),/exploreos-before-restore/);
  assert.deepEqual(await state(),backupState);

  await navigate('map');
  await page.locator('#notice').waitFor({state:'hidden'});
  // The card body opens the direction, while Edit keeps its own action.
  const firstDirectionCard=page.locator('.direction').first();
  const firstDirectionId=(await state()).directions[0].id;
  await firstDirectionCard.locator('p').click();
  assert.equal(await page.locator('#direction-filter').inputValue(),firstDirectionId);
  await navigate('map');
  await firstDirectionCard.locator('[data-action="edit-direction"]').click();
  assert.equal(await page.locator('#dialog-title').innerText(),'编辑探索方向');
  await page.locator('#close-dialog').click();
  await page.screenshot({path:'tests/desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await noOverflow('The mobile map should fit the viewport.');
  await page.screenshot({path:'tests/mobile.png',fullPage:true});
  await navigate('journal');
  await noOverflow('The mobile journal should fit the viewport.');
  await action('edit-session',firstRecord.id).click();
  await noOverflow('The mobile edit dialog should fit the viewport.');
  assert.equal(await page.locator('#form').getByRole('button',{name:'保存',exact:true}).isEnabled(),true);
  await page.locator('#close-dialog').click();
  assert.deepEqual(errors,[]);
  assert.deepEqual(unexpectedDialogs,[],'User text must never execute scripts or open alerts.');
  console.log('Browser smoke passed: create, optional fields, safe text, journal, edit, immutable snapshot, drafts, resume, skills, trash/restore, search/filter, problem-to-experiment, export/import, and mobile overflow.');
} finally {
  await browser.close();
}
