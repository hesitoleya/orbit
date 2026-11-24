'use strict';
// 基于现有双页面探针，仅在独立预览中注入 cosmicUpdate 内部异常。
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const base = path.join(__dirname, 'p2-isolated-pages-20261117.cjs');
let source = fs.readFileSync(base, 'utf8');
function replaceOnce(from, to) {
  const i = source.indexOf(from);
  if (i < 0 || source.indexOf(from, i + from.length) !== -1) throw Error('替换点缺失或不唯一: ' + from);
  source = source.slice(0, i) + to + source.slice(i + from.length);
}
replaceOnce("path.join(root,'.workbuddy','p2-isolated-pages-'+randomUUID())", "path.join(root,'tools','p2-internal-fault-report-'+randomUUID())");
replaceOnce("p.cosmicUpdate(0);if(inject)throw Error('injected:after-cosmic-update');", "window.__internalFault=inject;try{p.cosmicUpdate(0);}finally{window.__internalFault=false;}");
replaceOnce(".replace('window.__SE = {', 'window.__SE = { __p: {timeAtLg:cineTimeAtLg,JOURNEY,cosmicBuild,cosmicUpdate,getFrame:()=>frameId},');", ".replace('window.__SE = {', 'window.__SE = { __p: {timeAtLg:cineTimeAtLg,JOURNEY,cosmicBuild,cosmicUpdate,getFrame:()=>frameId},').replace('  CS.cam.matrixWorldInverse.copy(CS.cam.matrixWorld).invert();', '  CS.cam.matrixWorldInverse.copy(CS.cam.matrixWorld).invert(); if(window.__internalFault)throw Error(\"injected:cosmicUpdate-after-camera-before-pxPerRad\");');");
replaceOnce("c.closeResult=await browser.send('Target.closeTarget',{targetId:b.target});targets=targets.filter(x=>x!==b.target);session=a.session;c.mainAfter=await sample('main',null,false);", "c.closeResult=await browser.send('Target.closeTarget',{targetId:b.target});targets=targets.filter(x=>x!==b.target);session=a.session;c.mainAfter=await sample('main',null,false);if(fault){const fresh=await page();c.freshTarget=fresh.target;await evaluate('__SE.__p.cosmicBuild();true');await frames(3);c.freshCosmos=await sample('cosmos',c.mainBefore.state,false);c.freshClosed=await browser.send('Target.closeTarget',{targetId:fresh.target});targets=targets.filter(x=>x!==fresh.target);session=a.session;c.mainAfterFresh=await sample('main',null,false);}");
replaceOnce("c.exception.includes('injected:after-cosmic-update')", "c.exception.includes('injected:cosmicUpdate-after-camera-before-pxPerRad')");
replaceOnce("closed:c.closeResult.success===true", "closed:c.closeResult.success===true,freshCosmos:fault?!!c.freshCosmos&&c.freshCosmos.nonzero>0&&c.freshCosmos.fbo.complete&&c.freshCosmos.errors.length===0&&c.freshClosed.success===true:true,mainAfterFresh:fault?!!c.mainAfterFresh&&!c.mainAfterFresh.state.contextLost&&c.mainAfterFresh.nonzero>0&&c.mainAfterFresh.fbo.complete&&c.mainAfterFresh.errors.length===0:true");
replaceOnce("'注入的是 JS 异常，不是真实 context loss、GPU 故障或资源分配失败；页面销毁不证明产品状态可恢复。'", "'在 cosmicUpdate 更新相机逆矩阵之后、pxPerRad 计算之前注入 JS 异常；销毁异常页面并新建页面，不是回滚，不证明产品状态恢复或硬件故障隔离。'");
const experiment = new Module(__filename, module);
experiment.filename = __filename;
experiment.paths = module.paths;
experiment._compile(source, __filename);
