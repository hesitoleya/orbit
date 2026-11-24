'use strict';
// 仅在独立源码预览中进行同渲染器双场景和人工权重混合，不用于产品。
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const base=path.join(__dirname,'p2-paired-3850fbdc-2f35-4910-97ce-a44a9c62b507-20261117.cjs');
let source=fs.readFileSync(base,'utf8');
function replaceOnce(a,b){const i=source.indexOf(a);if(i<0||source.indexOf(a,i+a.length)>=0)throw Error('替换点缺失或不唯一: '+a);source=source.slice(0,i)+b+source.slice(i+a.length);}
replaceOnce("'p2-paired-'+randomUUID()","'p2-same-renderer-mix-'+randomUUID()");
replaceOnce("'tools/test-deep-models.cjs'].map", "'tools/test-deep-models.cjs','tools/p2-paired-3850fbdc-2f35-4910-97ce-a44a9c62b507-20261117.cjs','tools/p2-same-renderer-mix-independent-20261117.cjs'].map");
replaceOnce("Math.abs(p.JOURNEY.lg-19.98)>1e-8", "!(p.JOURNEY.lg>=19.95&&p.JOURNEY.lg<20)");
replaceOnce("  draw('cosmos',cs.scene,cs.cam);", `  draw('cosmos',cs.scene,cs.cam);
  // 混合两个真实场景的半浮点目标，再除以 8 并量化；不是生产后处理。
  const out=new T.WebGLRenderTarget(96,64,{depthBuffer:false});targets.push(out);
  const q=new T.Scene(),qc=new T.OrthographicCamera(-1,1,1,-1,0,1),geo=new T.PlaneGeometry(2,2);
  const mat=new T.ShaderMaterial({uniforms:{a:{value:targets[0].texture},b:{value:targets[2].texture},w:{value:0}},vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'varying vec2 v;uniform sampler2D a;uniform sampler2D b;uniform float w;void main(){gl_FragColor=vec4(clamp(mix(texture2D(a,v).rgb,texture2D(b,v).rgb,w)/8.,0.,1.),1.);}',toneMapped:false,depthTest:false,depthWrite:false});q.add(new T.Mesh(geo,mat));
  try{for(const w of [0,0.25,0.5,0.75,1]){mat.uniforms.w.value=w;r.setRenderTarget(out);const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER);r.clear();r.render(q,qc);const pixels=new Uint8Array(96*64*4);r.readRenderTargetPixels(out,0,0,96,64,pixels);let nonzero=0,saturated=0;for(let i=0;i<pixels.length;i+=4)for(let j=0;j<3;j++){nonzero+=pixels[i+j]>0;saturated+=pixels[i+j]===255;}items.push({name:'mix',weight:w,fboComplete:status===gl.FRAMEBUFFER_COMPLETE,quantized:{nonzero,saturated,pixels:Array.from(pixels)}});}}finally{geo.dispose();mat.dispose();}`);
replaceOnce("for(const injection of [null,'main','cosmos']){\n  phase='同步双侧采样 '+injection;", "for(const lg of [19.96,19.98,19.99,19.99,19.98,19.96]){\n  const injection=null;phase='正反 seek '+lg;await evaluate('__SE.journeySeek(__SE.__paired.timeAtLg('+lg+'));true');await frames(3);\n  phase='同步双侧采样 '+lg;");
replaceOnce("result.cases.push(x);save();", "x.requestedLg=lg;result.cases.push(x);save();");
replaceOnce(" result.checks=result.cases.map(x=>", " result.comparisons=[0,1,2].map(i=>({lg:result.cases[i].requestedLg,forward:result.cases[i].items.map(v=>v.quantized.sha256),reverse:result.cases[5-i].items.map(v=>v.quantized.sha256)}));\n result.checks=result.cases.map(x=>");
replaceOnce("fboValid:x.items.length?x.items.every(i=>i.fbo.complete&&i.fbo.rgba16f&&i.fbo.quantizationComplete&&!i.errors.length):null", "fboValid:x.items.length===7&&x.items.every(i=>i.name==='mix'?i.fboComplete:i.fbo.complete&&i.fbo.rgba16f&&i.fbo.quantizationComplete&&!i.errors.length)");
replaceOnce("x.items.length===(x.inject==='main'?0:x.inject==='cosmos'?1:2)","x.items.length===7");
replaceOnce(" result.errors.push({phase:'完整状态隔离'", " result.limitations.push('权重仅是测试常数，采用同页复用、强制宇宙更新且不恢复宇宙状态；非独立实例或完整异常恢复。','只在接力前 19.96/19.98/19.99 正反 seek；像素有量化和饱和，非自然旅程和物理正确映射。','GPU 混合旁路生产 Bloom、ACES、眩光及 overlay，端点不能当作生产端点。');\n result.errors.push({phase:'完整状态隔离'");
const experiment=new Module(__filename,module);experiment.filename=__filename;experiment.paths=module.paths;experiment._compile(source,__filename);
