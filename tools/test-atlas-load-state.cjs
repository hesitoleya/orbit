'use strict';
// Execute the template's actual atlas load/open functions in a controlled VM; no browser or files written.
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8').replace(/\r\n/g,'\n');
function section(a,b) { const i=src.indexOf(a), j=src.indexOf(b,i); assert.ok(i>=0&&j>i&&src.indexOf(a,i+1)<0,'ambiguous or missing section'); return src.slice(i,j); }
const code=section('  var atlasLoadError = false;', '\n  function bind(){') + '\n' + section('  function load(){','\n  if (document.readyState===') + '\nthis.api={load,open,get state(){return {OBJ,atlasLoadError}}};';
function setup({inline=[], pages=[], protocol='http:', visible=false}) {
  const els={}; for(const k of ['#atlasModal','#amGrid','#amChips','#amFoot','#amSearch']) els[k]={textContent:'',focus(){},classList:{on:visible,add(){this.on=true;},remove(){this.on=false;},contains(){return this.on;}}};
  const requests=[]; let renders=0;
  const ctx={OBJ:[], location:{protocol}, $:s=>els[s], bind(){}, refreshInline(){ctx.OBJ=inline;}, render(){renders++;}, setTimeout(fn){fn();}, fetch(url){requests.push(url); const x=pages[requests.length-1]; if(x instanceof Error)return Promise.reject(x); return Promise.resolve(x);}};
  vm.runInNewContext(code,ctx); return {ctx,els,requests,get renders(){return renders;}};
}
const response=(records,ok=true)=>({ok,status:ok?200:404,json:()=>Promise.resolve({data:{records}})});
async function tick(){for(let i=0;i<20;i++) await new Promise(resolve=>setImmediate(resolve));}
(async()=>{
  let s=setup({inline:[{code:'embedded'}]}); s.ctx.api.load(); await tick(); assert.equal(s.requests.length,0); assert.equal(s.ctx.api.state.OBJ.length,1); s.ctx.api.open(); assert.equal(s.renders,1); console.log('PASS inline records take priority without network');
  s=setup({pages:[response([{code:'a'}]),response([{code:'b'}])],visible:true}); s.ctx.api.load(); await tick(); assert.equal(s.ctx.api.state.OBJ.length,2); assert.equal(s.renders,1); assert.equal(s.ctx.api.state.atlasLoadError,false); console.log('PASS two successful pages combined');
  s=setup({pages:[response([{code:'a'}]),response([],false)],visible:true}); s.ctx.api.load(); await tick(); assert.equal(s.ctx.api.state.OBJ.length,0); assert.equal(s.ctx.api.state.atlasLoadError,true); assert.match(s.els['#amGrid'].textContent,/加载失败或数据不可用/); console.log('PASS page two failure discards partial results and reports error');
  s=setup({pages:[response([],false)]}); s.ctx.api.load(); await tick(); s.ctx.api.open(); assert.match(s.els['#amGrid'].textContent,/加载失败或数据不可用/); console.log('PASS failure before open appears on open');
  s=setup({pages:[{ok:true,json:()=>Promise.resolve({})}]}); s.ctx.api.load(); await tick(); assert.equal(s.ctx.api.state.atlasLoadError,true); console.log('PASS malformed response rejected');
  s=setup({pages:[response([]),response([])]}); s.ctx.api.load(); await tick(); assert.equal(s.ctx.api.state.atlasLoadError,true); console.log('PASS empty response rejected');
  s=setup({protocol:'file:'}); s.ctx.api.load(); assert.equal(s.requests.length,0); s.ctx.api.open(); assert.match(s.els['#amGrid'].textContent,/加载失败或数据不可用/); console.log('PASS offline missing data does not fetch');
  console.log('Limit: VM stubs, not browser DOM, real API, pagination completeness, or data correctness.');
})().catch(e=>{console.error(e);process.exitCode=1;});
