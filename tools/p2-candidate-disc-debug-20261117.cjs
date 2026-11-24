'use strict';
/* 候选 v6 在 lg=21 为什么看不到银河盘照片：投影位置、屏幕半径、像素采样与红色接管试验。 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.workbuddy','p2-cand-disc-debug-'+randomUUID());
fs.mkdirSync(output);
const probe=function(){
 const s=window.__SE,cs=s.CS,T=s.THREE;
 const n=new T.Vector3(Math.cos(cs.theta)*Math.cos(cs.phi),Math.sin(cs.phi),Math.sin(cs.theta)*Math.cos(cs.phi));
 const camPos=cs.target.clone().addScaledVector(n,cs.orbitR);
 const toGal=camPos.clone().negate().normalize();
 const fwd=n.clone().negate();
 const mwp=cs.mwReal.position.clone(), P=cs.cam.projectionMatrix.clone(), V=cs.cam.matrixWorldInverse;
 const ndc=mwp.clone().applyMatrix4(V).applyMatrix4(P);
 const camToDisc=mwp.clone().length();
 return {angleFwdGal:fwd.angleTo(toGal)*180/Math.PI,
   discAngleFromCam:mwp.clone().normalize().angleTo(toGal)*180/Math.PI,
   ndc:[ndc.x,ndc.y,ndc.z],discSceneDist:camToDisc,scale:cs.mwReal.scale.x,
   visible:cs.mwReal.visible,opacity:cs.mwRealMat.opacity,hasMap:!!cs.mwRealMat.map,
   renderOrder:cs.mwReal.renderOrder,side:cs.mwRealMat.side,depthTest:cs.mwRealMat.depthTest,
   camPosScene:[0,0,0],target:cs.target.toArray(),unit:cs.unit,orbitR:cs.orbitR,
   angleSpan:2*Math.atan((cs.mwReal.scale.x*0.5)/camToDisc)*180/Math.PI};
};
async function run(){
 const MIME={'.html':'text/html','.js':'text/javascript'};
 const server=http.createServer((req,res)=>{
   const p=path.join(root,'public',decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\/+/,''));
   if(!p.startsWith(path.join(root,'public'))||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}
   res.writeHead(200,{'content-type':MIME[path.extname(p)]||'application/octet-stream'});fs.createReadStream(p).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 const framework=path.join(root,'tools/test-deep-models.cjs');
 let src=fs.readFileSync(framework,'utf8');
 src=src.slice(0,src.indexOf('async function main() {'))
   .replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));","const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
 const driver=`(async()=>{try{
  await launch();
  await load('http://127.0.0.1:${port}/p2-candidate-preview-v7.html?auto=0&q=high&prewarm=0','http');
  await frames(3);
  await evaluate('__SE.journeySeek(__P2_CANDIDATE__.cineTimeAtLg(21.0));true');await frames(3);
  console.log('DISC',JSON.stringify(await evaluate('('+probe.toString()+')()')));
  const px=await evaluate(\`(()=>{const s=window.__SE,cs=s.CS,T=s.THREE;
    const gl=s.renderer.getContext();const c=s.renderer.domElement;
    const x=Math.round(c.width*0.5),y=Math.round(c.height*0.5);
    const buf=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    const before=Array.from(buf);
    cs.mwRealMat.color.setRGB(3,0,0);cs.mwRealMat.opacity=1;cs.mwRealMat.transparent=false;cs.mwRealMat.needsUpdate=true;
    return {before};})()\`);
  await frames(3);
  const after=await evaluate(\`(()=>{const s=window.__SE,gl=s.renderer.getContext(),c=s.renderer.domElement;
    const x=Math.round(c.width*0.5),y=Math.round(c.height*0.5);
    const buf=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    return {centerAfterRed:Array.from(buf),pixels:(()=>{const b=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,b);let red=0;for(let i=0;i<b.length;i+=4)if(b[i]>40&&b[i+1]<30)red++;return red;})()};})()\`);
  console.log('RED',JSON.stringify({px,after}));
 }catch(e){console.error('DBG-ERR',e.stack||String(e));}
 finally{
  try{server.close();}catch(_){}
  if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(_){}}browser&&browser.ws.close();
 }})();`;
 vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,server,probe){${src}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,server,probe);
}
run();
