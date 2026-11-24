'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'), output=fs.mkdtempSync(path.join(root,'.workbuddy','p2-production-mcomp-independent-'));
const app=fs.readFileSync(path.join(root,'public/js/app.js'),'utf8');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function between(start,end){const i=app.indexOf(start);if(i<0||app.indexOf(start,i+start.length)!==-1)throw Error('起点不唯一 '+start);const j=app.indexOf(end,i);if(j<0||app.indexOf(end,j+end.length)!==-1)throw Error('终点不唯一 '+end);return app.slice(i,j);}
const vs=between('const POST_VS = [','/* three 的 ACES'),common=between('const POST_COMMON = [','const _post = {'),material=between('_post.mComp = new THREE.ShaderMaterial({','\r\n    }\r\n    _post.ok = true; _post.w = w; _post.h = h;');
const extracted=vs+'\n'+common+'\n'+material;
fs.writeFileSync(path.join(output,'extraction.js'),extracted);
let source=fs.readFileSync(path.join(__dirname,'test-deep-models.cjs'),'utf8');
function replaceOnce(a,b){let i=source.indexOf(a);if(i<0||source.indexOf(a,i+a.length)>=0)throw Error('脚手架替换点不唯一');source=source.slice(0,i)+b+source.slice(i+a.length);}
async function mainTest(){
 report.experiment='生产 mComp 有限输入独立 GPU 和 CPU 数学基准'; report.outputDirectory=output;
 report.hashes={app:hash(app),three:hash(fs.readFileSync(path.join(ROOT,'public/js/three.min.js'))),extraction:hash(extracted),vs:hash(vs),common:hash(common),material:hash(material)};
 report.notes=['从 app.js 唯一边界原样抽取完整构造表达式；未加载产品入口。','CPU 为独立手写端点基准，常量 HDR 与预制 bloom；glare 的星芒和鬼影关闭，太阳晕和面纱开关测试。','输入为 1x1 Float32 数据纹理，不是生产 RGBA16F render target；RGBA8 输出包含量化。固定颗粒相位但 GPU sin 精度可能造成噪声差异。中间权重无生产真值。','脚手架保留的 urls、viewport 为未使用的默认字段，实际为隔离 about:blank 与 4x4 离屏渲染。','不覆盖真实 bright/blur、场景 draw、直接路径、MSAA、GPU 状态恢复、resize、截图、上下文丢失或视觉。'];
 await launch(); await evaluate(fs.readFileSync(path.join(ROOT,'public/js/three.min.js'),'utf8')+'\n;true');
 const r=await evaluate('('+gpuTest.toString()+')('+JSON.stringify(extracted)+')');report.gpuTest=r;report.tests=r.tests;
}
function gpuTest(extracted){
 const tests=[],check=(name,ok,details)=>tests.push({name,status:ok?'pass':'fail',details});
 const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(4,4,false);renderer.toneMapping=THREE.NoToneMapping;
 const gl=renderer.getContext(),dbg=gl.getExtension('WEBGL_debug_renderer_info');
 const metadata={revision:THREE.REVISION,webgl2:renderer.capabilities.isWebGL2,renderer:dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),floatTexture:!!gl.getExtension('OES_texture_float')};
 const create=new Function('THREE','GRADE',`const _post={}; ${extracted}; return _post.mComp;`),mat=create(THREE,{on:false});
 check('生产材质配置',mat.toneMapped===false&&!mat.depthTest&&!mat.depthWrite&&Object.keys(mat.uniforms).length===23,{toneMapped:mat.toneMapped,uniformNames:Object.keys(mat.uniforms)});
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),mat);scene.add(quad);
 const out=new THREE.WebGLRenderTarget(4,4,{depthBuffer:false,stencilBuffer:false});
 const A={scene:[4,.5,2],b:[[.4,.2,.1],[.2,.4,.1],[.3,.1,.2],[.1,.2,.3],[.2,.1,.4]]},B={scene:[.5,3,1],b:[[.1,.3,.4],[.4,.1,.2],[.2,.3,.1],[.3,.2,.1],[.1,.4,.2]]};
 function tex(v){const t=new THREE.DataTexture(new Float32Array([...v,1]),1,1,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.NearestFilter;t.needsUpdate=true;return t;}
 let textures=[];function setInput(d){textures.forEach(t=>t.dispose());textures=[tex(d.scene),...d.b.map(tex)];['tScene','tB1','tB2','tB3','tB4','tB5'].forEach((k,i)=>mat.uniforms[k].value=textures[i]);}
 const u=mat.uniforms;u.uStrength.value=.8;u.uExposure.value=1;u.uWide.value=1;u.uWGain.value=1;u.uSunUV.value.set(.23,.32);u.uSunTint.value.set(1,.9,.7);u.uSunAtm.value=.8;u.uGlareK.value=.7;u.uStarK.value=0;u.uGhost.value=0;u.uAspect2.value=1.6;u.uGradeT.value=0;
 function draw(){renderer.setRenderTarget(out);renderer.render(scene,camera);const pixels=new Uint8Array(64);renderer.readRenderTargetPixels(out,0,0,4,4,pixels);return Array.from(pixels);}
 const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x)),mix=(a,b,t)=>a*(1-t)+b*t,smooth=(a,b,x)=>{let t=clamp((x-a)/(b-a));return t*t*(3-2*t);},dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
 function cpu(d,x,y,cosmos,grade,glare){
  const uv=[(x+.5)/4,(y+.5)/4],q=[(uv[0]-.5)*1.6,uv[1]-.5],r2=dot(q,q),w=[.36,.30,.26,.20,.16];
  let c=d.scene.map((v,i)=>v+.8*d.b.reduce((s,b,j)=>s+b[i]*w[j],0));
  if(glare){const dx=(uv[0]-.23)*1.6,dy=uv[1]-.32,r=Math.hypot(dx,dy),sv=.65*.8,g=Math.exp(-r*4.6)*.95+Math.exp(-r*1.35)*.20+Math.exp(-r*42)*5.5;c=c.map((v,i)=>(v+[1,.9,.7][i]*g*sv*.7)*(1-.13*sv*.7*(.4+.6*sv)));}
  const m=(v,a)=>a.map(row=>dot(row,v));c=c.map(v=>v/ .6);c=m(c,[[.59719,.35458,.04823],[.076,.90834,.01566],[.0284,.13383,.83777]]);c=c.map(v=>(v*(v+.0245786)-.000090537)/(v*(.983729*v+.432951)+.238081));c=m(c,[[1.60475,-.53108,-.07367],[-.10208,1.10813,-.00605],[-.00327,-.07276,1.07602]]).map(v=>clamp(v));
  if(cosmos){c=c.map((v,i)=>v+smooth(.70,1,v)*[1,.70,.44][i]*.085);const l=dot(c,[.2126,.7152,.0722]),k=smooth(.16,.82,l);c=c.map((v,i)=>mix(v*[.945,.985,1.065][i],v*[1.055,1.005,.945][i],k));c=c.map(v=>clamp(Math.max(v-.012,0)/.988));c=c.map(v=>mix(v,v*v*(3-2*v),.08)*1.035);}
  if(grade){c=c.map(v=>clamp(v));c=c.map(v=>mix(v,v*v*(3-2*v),.12));const lum=dot(c,[.2126,.7152,.0722]);c=c.map(v=>mix(lum,v,1.05)*mix(1,.88,smooth(.10,.52,r2)));}
  c=c.map(v=>v<=.0031308?v*12.92:Math.pow(v,.41666)*1.055-.055);
  if(grade){const gp=[x+.5,y+.5],z=Math.sin(dot(gp,[12.9898,78.233]))*43758.5453,n=z-Math.floor(z),l=dot(c,[.22,.72,.06]),g=(n-.5)*.020*clamp(l*(1-l)*4);c=c.map(v=>v+g);}
  return c.map(v=>Math.round(clamp(v)*255));
 }
 for(const cosmos of [0,1])for(const grade of [0,1])for(const glare of [0,1]){u.uCosmos.value=cosmos;u.uGrade.value=grade;u.uSunVis.value=glare?.65:0;
  for(const [label,d] of [['A',A],['B',B]]){setInput(d);const p=draw(),again=draw(),diff=[],perChannel=[0,0,0];let repeats=0;
   for(let y=0;y<4;y++)for(let x=0;x<4;x++){const expected=cpu(d,x,y,cosmos,grade,glare);for(let k=0;k<3;k++){const i=(y*4+x)*4+k,e=Math.abs(p[i]-expected[k]);diff.push(e);perChannel[k]=Math.max(perChannel[k],e);if(p[i]!==again[i])repeats++;}}
   const tolerance=grade?4:2;check(`端点 ${label} cosmos=${cosmos} grade=${grade} glare=${glare}`,Math.max(...diff)<=tolerance&&repeats===0,{toleranceBytes:tolerance,maxByChannel:perChannel,meanBytes:diff.reduce((a,b)=>a+b,0)/diff.length,differences:diff,repeatedByteDifferences:repeats,rgba:p});
  }
  for(const t of [.25,.5,.75]){const d={scene:A.scene.map((v,i)=>mix(v,B.scene[i],t)),b:A.b.map((row,j)=>row.map((v,i)=>mix(v,B.b[j][i],t)))};setInput(d);const p=draw(),p2=draw();check(`候选混合 t=${t} cosmos=${cosmos} grade=${grade} glare=${glare}`,p.every((v,i)=>v===p2[i]),{rgba:p,meaning:'CPU 先线性混合输入后执行一次生产 mComp；仅重复性，无中间权重生产真值'});}
 }
 const errors=[];for(let i=0;i<16;i++){const e=gl.getError();if(e===gl.NO_ERROR)break;errors.push(e);}check('WebGL 无错误且上下文有效',errors.length===0&&!gl.isContextLost(),{errors,lost:gl.isContextLost()});
 textures.forEach(t=>t.dispose());out.dispose();mat.dispose();quad.geometry.dispose();renderer.dispose();return {metadata,input:{A,B},tests};
}
const start=source.indexOf('async function main() {'),end=source.indexOf('\nfunction cleanup()',start);if(start<0||end<0)throw Error('main 不存在');source=source.slice(0,start)+`async function main(){return (${mainTest.toString()})();}`+source.slice(end);
replaceOnce('const REPORT_FILE = path.join(ROOT, `deep-models-test-184-${RUN_ID}.json`);',"const REPORT_FILE = path.join(output, 'report.json');");
replaceOnce("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));","const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
replaceOnce('report.complete = report.ok && !FAST;','report.complete = false;');
vm.runInThisContext(`(function(require,__dirname,__filename,output,gpuTest,extracted,app,hash,vs,common,material){${source}\n})`,{filename:path.join(__dirname,'test-deep-models.cjs')})(require,__dirname,path.join(__dirname,'test-deep-models.cjs'),output,gpuTest,extracted,app,hash,vs,common,material);
