'use strict';
// Isolated source preview; exclusive creation only, never rewrites formal artifacts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
let app=read('public/js/app.js'), html=read('public/index.html');
function once(text,needle,replacement){const i=text.indexOf(needle);if(i<0||text.indexOf(needle,i+needle.length)>=0)throw Error('missing/nonunique marker: '+needle);return text.slice(0,i)+replacement+text.slice(i+needle.length);}
const probe=`
let __p2FrameKind=null,__p2Pending=null,__p2Before=null,__p2After=null;
window.__P2_FRAME_PROBE__={get result(){return {before:__p2Before,after:__p2After};}, errors:[]};
function __p2Capture(K){
 if(!__p2FrameKind||!JOURNEY.on||!JOURNEY.cine||__p2After)return;
 try { const q=K.getWorldQuaternion(new THREE.Quaternion()),f=K.getWorldDirection(new THREE.Vector3()),u=new THREE.Vector3(0,1,0).applyQuaternion(q),r=new THREE.Vector3(1,0,0).applyQuaternion(q);
 __p2Pending={frame:frameId,now:performance.now(),lg:JOURNEY.lg,kind:__p2FrameKind,camAbs:camAbs.toArray(),sun:SUN.pos.toArray(),sunGal:SUN_GAL.toArray(),forward:f.toArray(),up:u.toArray(),right:r.toArray(),projection:K.projectionMatrix.toArray(),inverse:K.projectionMatrixInverse.toArray(),world:K.matrixWorld.toArray(),target:CS.target.toArray(),radius:CS.orbitR,unit:CS.unit,theta:CS.theta,phi:CS.phi,draw:[renderer.domElement.width,renderer.domElement.height],dpr:renderer.getPixelRatio(),completed:false};
 } catch(e){window.__P2_FRAME_PROBE__.errors.push(String(e));__p2Pending=null;}
}
function __p2Done(){try{if(!__p2Pending)return;__p2Pending.completed=true;if(__p2Pending.kind==='main')__p2Before=__p2Pending;else if(__p2Before)__p2After=__p2Pending;__p2Pending=null;}catch(e){window.__P2_FRAME_PROBE__.errors.push(String(e));}}
`;
app=once(app,'function renderFrame(scRef, camRef, options) {',probe+'\nfunction renderFrame(scRef, camRef, options) {');
app=once(app,'  const needPost = deepActive || (BLOOM.on && str > 0.001) || (GLARE.on && GLARE.vis > 0.002);','  __p2Capture(K);\n  const needPost = deepActive || (BLOOM.on && str > 0.001) || (GLARE.on && GLARE.vis > 0.002);');
app=once(app,'    renderFrame(CS.scene, CS.cam);\n    return;','    __p2FrameKind=\'cosmic\'; try { renderFrame(CS.scene, CS.cam); __p2Done(); } finally { __p2FrameKind=null; }\n    return;');
app=once(app,'  /* 对话 84：所有帧都走 renderFrame（Bloom 开关在里面判断） */\n  renderFrame();',"  /* 对话 84：所有帧都走 renderFrame（Bloom 开关在里面判断） */\n  __p2FrameKind='main'; try { renderFrame(); __p2Done(); } finally { __p2FrameKind=null; }");
html=once(html,'<script type="module" src="./js/app.js"></script>','<script type="module" src="./js/p2-frame-preview.js"></script>');
const outputs=[['public/js/p2-frame-preview.js',app],['public/p2-frame-preview.html',html]];
for(const [p] of outputs)if(fs.existsSync(path.join(root,p)))throw Error('refusing overwrite: '+p);
for(const [p,s] of outputs)fs.writeFileSync(path.join(root,p),s,{flag:'wx'});
console.log(JSON.stringify({sourceApp:hash(read('public/js/app.js')),sourceHtml:hash(read('public/index.html')),outputs:outputs.map(([p,s])=>({path:p,sha256:hash(s)}))},null,2));
