# v215 宇宙层视觉修复

## 为什么原来像示意图

现场审查定位到不是单纯亮度问题：真实星系目录点云是 additive 2px 点图；手绘 WEB_LINKS 会与真实目录叠加；结构标签可悬浮在被隐藏的物体上；最严重的是 `cosmicBuild` 创建的照片材质在创建后立即被丢弃，随后异步加载只把 `.map` 写进不采样 map 的分析 ShaderMaterial，真实星系照片实际没有进入宇宙层画面。

## 正式修复

- v213/v214/v215 保持在同一连续修复链，当前正式 `v215-cosmic-diagnostics`。
- 每个目录星系保留独立 `GalaxyPhotoLayer` Mesh，使用真实照片材质；分析体积仍作为艺术/深度补充层，异步照片加载直接更新这个 Mesh，不再把 map 写到不采样的体积 ShaderMaterial。
- 默认开启宇宙照片加载，可用 `?galTex=0` 显式关闭；原照片/授权路径没有改变。
- SDSS目录点云 `uAlpha` 从0.20降为0.05，避免267k级目录在远景 additive 叠加成白雾。
- 真实目录存在时，手绘程序宇宙网在SDSS范围让位；程序网与FIL骨架的 visibility 不再被 inside-sphere 的无条件 `true` 覆盖。
- 无可见几何的结构不再保留悬浮标签；远距结构标签收紧。无照片结构的 billboard 最小符号尺寸由12px降到5px，避免地图图标压过宇宙内容。
- 删除宇宙层末尾对所有结构的 blanket hide，改为保留自己的LOD；照片层按照当前目录星系的尺度和insideK同步显示。
- 新增 `__SE.cosmicVisualInfo()`，供现场验收读取照片层、贴图、目录点数与程序网开关。

## 真实GPU现场证据

BrowserSkill session `ojos` 使用 NVIDIA/ANGLE WebGL2，访问重建后的8173正式入口：

- build readback：`v215-cosmic-diagnostics`。
- `cosmos(3e22, ...)` 后：62个 photo layer，62个有纹理，2个当前达到照片可见尺度；目录点数267503；`uAlpha=0.05`；procedural web=false；procedural web points=false。
- 同一浏览器同一入口在 `cosmos(3e25, ...)` 后：62个 photo layer，贴图仍在；照片按真实角径全部退出，procedural web=true，进入远景全天填充接力。
- 1205×647真实canvas在下一帧 `finish/readPixels`：`glError=0`，2926个非黑像素、201个高亮像素。此前立即读回得到全黑只是尚未等到一帧，不作为结果。
- 远景状态没有使用CPU图片代替GPU；读回是实际WebGL2 framebuffer。

## v216 远景交接补充

- 远景目录点云加入密度驱动的点大小/透明度变化，不再所有点固定2px视觉权重。
- 银河解析体积加入1.5px以上的低增益中间halo LOD，避免从可解析银河直接跳成单个locator。
- 真实GPU v216（session `dutx`，独立8175入口，WebGL2）：R=3e22下一帧读回1572×827，`glError=0`，4633非黑像素/299高亮像素；cosmicVisualInfo为62 photoLayers、62 mapped、4 visible、uAlpha=.05、proceduralWeb=false。R=3e25同页交接为proceduralWeb=true、photoVisible=0、贴图层仍为62/62保留。
- 这两组是同一正式shader在两个尺度的GPU运行状态，不是CPU渲染或图片替代；分辨率与前一轮不同，因此不把像素数量直接当作画质提升百分比。

## 限制

本轮修复了“真实照片死管线”和“白雾/手绘网/悬浮标签”缺陷，但没有宣称完整电影级宇宙层完成：照片是观测二维影像，不是三维重建；62个照片层的中远景仍按角径LOD隐藏；程序宇宙网仍是艺术背景填充；不同角度、旅程全程、M51体积与GPU帧时还需继续验收。浏览器截图工具仍受临时目录权限限制，因此交付的是GPU状态/读回证据，而非保存截图。
