'use strict';
/* 单点调试：对比 CS.gals[i].quaternion 与 Euler 重建 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.workbuddy','p2-pa-debug-'+randomUUID());
fs.mkdirSync(output);
async function run(){
  const prev=fs.readdirSync(path.join(root,'.workbuddy')).filter(d=>d.startsWith('p2-coordinate-merge-')).sort().map(d=>path.join(root,'.workbuddy',d,'preview.html')).filter(f=>fs.existsSync(f)).pop();
  if(!prev)throw Error('无预览');
  fs.copyFileSync(prev,path.join(output,'preview.html'));
  const framework=path.join(root,'tools/test-deep-models.cjs');
  let src=fs.readFileSync(framework,'utf8');
  src=src.slice(0,src.indexOf('async function main() {'))
    .replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));","const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
  const driver=`(async()=>{try{
    await launch();
    await load(pathToFileURL(path.join(output,'preview.html')).href+'?auto=0&q=high&prewarm=0','file');
    await frames(3);
    const out=await evaluate(\`(async()=>{
      const p=window.__coord,T=__SE.THREE,cs=__SE.CS; p.cosmicBuild();
      const res=[];
      for(const i of [28,22,0]){
        const r=p.GAL_CAT[i],g=cs.gals[i];
        const incl=r[6]*Math.PI/180, pa=r[7]*Math.PI/180;
        const photoIncl=Math.min(incl*0.18,0.30);
        const qNeg=new T.Quaternion().setFromEuler(new T.Euler(-photoIncl,-pa,0,'YXZ'));
        const qPos=new T.Quaternion().setFromEuler(new T.Euler(photoIncl,pa,0,'YXZ'));
        res.push({i,name:r[0],incl:r[6],pa:r[7],
          actual:g.quaternion.toArray(),
          neg:qNeg.toArray(),pos:qPos.toArray(),
          angNeg:g.quaternion.angleTo(qNeg)*180/Math.PI,
          angPos:g.quaternion.angleTo(qPos)*180/Math.PI});
      }
      return res;
    })()\`);
    console.log(JSON.stringify(out,null,1));
  }catch(e){console.error(errorText(e));process.exitCode=1;}finally{
    if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(_){}browser.ws.close();}
    else if(child&&child.exitCode===null)child.kill();
  }})();`;
  vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output){${src}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output);
}
run().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
