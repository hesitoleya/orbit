/* Scene presentation only: no renderer changes and no HTML from asset metadata. */
(function(root){'use strict';
 const families={6:'开放电离壁',7:'环状气体',8:'超新星遗迹',9:'四柱侵蚀',10:'双极外流',11:'暗尘埃悬崖',12:'厚壳气体',13:'M51 影像引导'};
 const mechanisms={6:'观察重点：亮气体薄壁与前景暗尘埃交错。真实发射星云的辐射来自受激或电离气体；这里用艺术发射率与消光场演示层次。',7:'观察重点：环缘与中央视线的不同光程。行星状星云与行星无关，是演化恒星抛出的气体；此环形模板不代表某个目标的测得壳层。',8:'观察重点：壳层中的丝状结构与空隙。超新星遗迹包含激波和抛射物；本场景没有求解流体、激波或真实膨胀年代。',9:'观察重点：受照亮缘与背后的不透明尘埃。柱体形态源于打印模型，内部密度和侵蚀纹理是艺术假设，不是模型自带的科学密度。',10:'观察重点：两侧外流的空间分离。双极形态是共享示意，没有重建真实速度场或光谱。',11:'观察重点：暗尘埃遮挡背景发光气体形成的剪影。暗星云不是完全无辐射的空洞；这里仅模拟可见外观中的吸收与发射。',12:'观察重点：视线穿过壳边与中心的光程差。壳状外观不能单凭照片确定其三维深度；本模板的厚度与内部结构为艺术设定。',13:'观察重点：旋臂、尘埃带和伴星系。原照片已含视线消光，附加艺术消光可能重复计入；倾斜观察下的厚度和遮挡不是测得几何。'};
 const qualityNames={low:'流畅',mid:'标准',high:'精细',ultra:'极致'};
 function describe({type=null,name='',quality='high',enabled=true,state={}}={}){
  const supported=state.supported!==false;enabled=enabled&&supported;
  const steps=quality==='low'?128:quality==='ultra'?448:320;
  const profile=(state.profiles||[]).find(p=>p.type===type),diagnostic=(state.diagnostics||[]).find(p=>p.type===type);
  const dims=diagnostic?.dimensions || profile?.dimensions,ready=enabled&&(state.ready||[]).includes(type),loading=enabled&&(state.loading||[]).includes(type),error=enabled&&(state.errors||[]).find(e=>e.type===type);
  const family=families[type]||null,dimensionText=dims?dims.join('×'):'待加载后读取';
  const title=family?(name||'当前目标')+' · '+family+(type===13?'艺术体积':'形态模板（同类共享）'):'深空体积 · 尚未选择目标';
  const qualityText=(qualityNames[quality]||'精细')+' · 体积采样上限 '+steps+'；可提前终止。'+(state.previewTypes?.includes(type)?'离线流畅档使用 32³ 预览；其余档位细化到原始体积。':'画质档位不改变体积素材尺寸或下载量。');
  let status=!supported?'当前设备未提供WebGL2高质量体积支持 · 使用基础解析示意':!enabled?'高质量体积已关闭 · 使用基础解析示意':!family?'7 种共享形态模板 + M51 影像引导体积 · 选择目标后按需加载':loading?'当前目标体积正在解压与校验…':error?'当前目标体积加载失败 · 基础解析示意可用，可点击「重试当前体积」':ready?(type===13?'M51 图像引导艺术体积就绪（非实测深度）':'三维气体 / 尘埃 / 自阴影光场就绪')+(diagnostic&&diagnostic.directionalShading?' · 含方向光照缓存':''):'当前目标尚未加载 · 基础解析示意可用';
  if(ready)status+=' · 素材 '+dimensionText+' · 估算纹理缓存 '+((state.gpuBytes||0)/1048576).toFixed(1)+' MiB（不含驱动与CPU暂存）';
  const truth=type===13?'源影像 Hubble heic0506a 4000×2776；512×64×512 是派生体素网格，不是实测深度。沿原倾斜视角赋予艺术厚度，未去投影；NGC5195 属同幅影像，非独立三维模型。':family?'当前目标使用共享形态艺术模板，不是该目标的专属三维重建；密度、颜色、内部深度与光源布局均含艺术假设。':'近景形态、观测照片和统计结构标记是不同数据层，不应把艺术模板当成目标的实测三维结构。';
  const provenance=type===9?'形态种子：NASA/STScI 四柱打印模型；气体、侵蚀、发射率和光场为原创艺术处理。原模型不宣称CC0。':type===13?'来源：NASA, ESA, S. Beckwith (STScI), The Hubble Heritage Team (STScI/AURA) · CC BY 4.0；含改色、背景抑制、假定厚度和附加消光。':family?'原创数学体积艺术 · CC0；不是下载的观测三维密度。':'素材来源按当前场景分别标注。';
  return {title,status,qualityText,truth,provenance,mechanism:mechanisms[type]||'选择星云或M51后显示当前形态的观察提示。',ready,loading,supported,canRetry:!!(supported&&enabled&&family&&error&&!loading),failed:!!error,dimensionText,steps};
 }
 root.ORBIT_CINEMATIC_CONTENT={describe,families};
})(typeof window==='undefined'?globalThis:window);
