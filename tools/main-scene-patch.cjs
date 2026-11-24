'use strict';
function transformApp(s){
 s=s.replace(/\r\n/g,'\n');
 const once=(a,b)=>{if(s.split(a).length!==2)throw Error('Ambiguous marker '+a.slice(0,100));s=s.replace(a,()=>b);};
 once("const BUILD = 'v198';","const BUILD = 'v199-main-3d';\nconst MAIN_VOLUMES = window.createMainVolumes(THREE);");
 const start=s.indexOf('(function bindDeepModels() {'),end=s.indexOf('\n})();',start);
 if(start<0||end<start)throw Error('Missing legacy module');
 s=s.slice(0,start)+'/* Standalone close-up mode removed; main scene owns navigation and volumes. */\n'+s.slice(end+7);
 once("  const deepId = deepIdForName(nb.n);", "  const deepId = null; /* no separate close-up module */");
 // Keep archival photo data in the encyclopedia, not on astronomical geometry.
 once("var GAL_TEX_ON = params.get('galTex') !== '0';","var GAL_TEX_ON = false;");
 once("const BODY = { on: params.get('body') !== '0' && SET.body !== 0 };","const BODY = { on: true };");
 once("  if (!GAL_TEX_ON || params.get('galCloseHD') === '0' || !credit) return;","  if (!GAL_TEX_ON || params.get('galCloseHD') === '0' || !credit) return;");
 once('function updateGalaxyCloseupCredit() {','function updateGalaxyCloseupCredit() {\n  return; /* photographs remain in archive only */');
 once('    const m = new THREE.Mesh(geo, mat);\n    /* 对话 159：照片是',`    const m = MAIN_VOLUMES.create(type, i*7919+31, [1,1,1], {
      arms: type===1?2:(name==='M33'?3:2), pitch:name==='M31'?8.4:(name==='M83'?5.1:6.5), bar:type===1?1.3:0 });
    mat.dispose();\n    /* 对话 159：照片是`);
 once("new THREE.Euler(-photoIncl, -pa, 0, 'YXZ')","new THREE.Euler(-incl, -pa, 0, 'YXZ')");
 once('    m.visible = GAL_TEX_ON;','    m.visible = true;');
 once('    m.visible = GAL_TEX_ON && szPx > cineLod;','    m.visible = szPx > 7 && insideK > 0.02;\n    m.material.uniforms.uGain.value = 2.0 * insideK;');
 once('    m.material.color.setScalar(1.0);','    /* analytic field owns emission */');
 once('    m.scale.set(sz, sz, sz);\n    /* 远处太小的星系', '    m.scale.setScalar(sz*0.5);\n    /* 远处太小的星系');
 once('    m.material.opacity = (d.lg ? 1.0 : 0.95) * faceK;','    /* no photo alpha */');
 once('const bodyWeight = photoK ? 0.08 * smoothstep(szPx, 45, 210) : 1;','const bodyWeight = 0.25 * smoothstep(szPx, 25, 180);');
 once('CS.orbitR = Math.max(d.dia * 2.0, 1.5e20);','CS.orbitR = Math.max(d.dia * 1.15, 1.5e19);');
 once('function focusClusterPhoto(name, key) {','function focusClusterPhoto(name, key) {\n  showNebulaCredit({n:name}, "三维统计星族；非逐星实测重建"); return;');
 once("n: 220, radiusKpc: 0.10, shape: 'globular',","n: 5000, radiusKpc: 0.10, shape: 'globular',");
 once('  cosmicHUD();',`  /* A real ray-integrated Galactic volume replaces Gaia image slices. */
  if (!CS.mainGalaxy) { CS.mainGalaxy=MAIN_VOLUMES.create(1,159,[1,1,1],{arms:4,pitch:7.2,bar:1.2,gain:1.8}); CS.scene.add(CS.mainGalaxy); }
  CS.mainGalaxy.position.copy(CS.mw.position); CS.mainGalaxy.scale.setScalar(5.0e20/unit);
  CS.mainGalaxy.visible=insideK>.02 && lgR<24 && mwPx>7;
  if(CS.mwReal)CS.mwReal.visible=false;if(CS.mwCore)CS.mwCore.visible=false;if(CS.dustGroup)CS.dustGroup.visible=false;CS.mw.visible=false;
  if(CS.gcPhoto)CS.gcPhoto.visible=false;
  (CS.cosItems||[]).forEach(m=>{if(!m.userData.bh&&!m.userData.quasar)m.visible=false;});
  cosmicHUD();`);
 // Near nebulae use fixed world-space volume geometry, not camera-facing images.
 once('function enterNebula(idx) {',`function enterNebula(idx) {
  const item=(window.__NEB||[])[idx];
  if(item && item.t==='galaxy') { leaveExo(); leaveNebula(); journeyStop(true); cosmicEnter(); const m=CS.gals.find(g=>item.n.includes(g.userData.name)||g.userData.name===item.n); if(m){CS.flyTo(m);return m;} }
`);
 once('  return NEB.body;',`  NEB.group.visible=false;
  if(NEB.mainVolume){ scene.remove(NEB.mainVolume); NEB.mainVolume.material.dispose(); }
  const kind=nb.shape===1?7:nb.shape===2?8:nb.shape===3?9:nb.shape===4?10:6;
  NEB.mainVolume=MAIN_VOLUMES.create(kind,idx*7919+17,nb.c,{gain:2.4});
  scene.add(NEB.mainVolume);
  showNebulaCredit(nb,'主场景三维发射/吸收密度场，可环绕；形态为示意，非观测三维反演');
  return NEB.body;`);
 once('function updateNebula(origin) {',`function updateNebula(origin) {
  if(NEB.active==null)return;
  if(NEB.mainVolume){NEB.mainVolume.position.copy(NEB.body.pos).sub(origin);NEB.mainVolume.scale.setScalar(NEB.body.radius);NEB.group.visible=false;return;}
`);
 once('function leaveNebula() {',`function leaveNebula() {
  if(NEB.mainVolume){scene.remove(NEB.mainVolume);NEB.mainVolume.material.dispose();NEB.mainVolume=null;}
`);
 // Disable all asynchronous photography callbacks for geometry; archive unaffected.
 once('    if (nb.photo && SKY_PHOTO) loadSkyPhoto','    if (false && nb.photo && SKY_PHOTO) loadSkyPhoto');
 once('  if (nb.nearPhoto && SKY_PHOTO) {','  if (false && nb.nearPhoto && SKY_PHOTO) {');
 // Hide legacy sky cards; these are illustrative background annotations, not objects.
 once('    nebMats.push(mat);\n    starfield.add(sp);','    nebMats.push(mat);\n    sp.visible=false;\n    starfield.add(sp);');
 once('if (NEB.sprite) NEB.sprite.visible = true;','if (NEB.sprite) NEB.sprite.visible = false;');
 once("deepPerfDetails.addEventListener('toggle', resetDeepObservation);", "if (deepPerfDetails) deepPerfDetails.addEventListener('toggle', resetDeepObservation);");
 once("  deepPerfStatus.textContent = '数据不足';", "  if (deepPerfStatus) deepPerfStatus.textContent = '数据不足';");
 once('  if (!deepPerfDetails.open) return;', '  if (!deepPerfDetails || !deepPerfDetails.open) return;');
 // Public diagnostics: no separate scene/camera or mode.
 once('window.__SE = {',`window.__SE = {
  main3DInfo(){return {galaxies:CS.gals?CS.gals.length:0,volumes:CS.gals?CS.gals.filter(m=>m.name==='MainSceneVolume').length:0,nebula:!!NEB.mainVolume,standaloneModule:false,truth:'Illustrative fixed 3D fields; not observational reconstruction'};},`);
 return s;
}
module.exports={transformApp};
