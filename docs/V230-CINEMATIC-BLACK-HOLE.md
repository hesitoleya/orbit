# v230 黑洞重做：电影化 Schwarzschild 近似

## 用户反馈后更新：不规则气体盘（2026-11-22）

- 用户反馈“环有条纹，想更真实”：当前去掉固定sin(2ang+1.45r)螺旋调制、四倍角fil以及folded ridge comb；换成方向域domain warp、两层低对比气体密度和弱温度扰动，不用规则明暗沟壑模拟湍流。
- 依据相机角像素锥和交点距离估计footprint，淡化/跳过亚像素中高频，不在分支光线循环中调用不可靠的dFdx/dFdy。并重新要求escaped后才采背景；解析阴影遮罩仅软化已确认背景，不代替逃逸。
- 保留当前工作区已有的HalfFloat线性HDR→亮度阈值→两级可分离高斯→单次ACES/gamma合成，不回退到旧LDR路径。当前盘强度0.54、曝光0.92；旧文档16/.62/1.02仅描述此前版本。
- 实机新页面gqlo验证：fragmentShader含新turbulence、不含旧stripe，uPixelCone约0.00118，7个render pass、GL0、中心RGBA=(0,0,0,255)。RTX4060 Laptop GPU query disjoint=false：单光线pass四档1.041/1.451/2.246/2.800ms；整7-pass实际调用周围查询单样本5.266/5.627/5.763/10.848ms。非整应用FPS，隐藏页面/单样本只作为性能边界证据。
- 一次尝试复放共享模糊材质的测量方法产生feedback-loop GL错误，该批计时已丢弃；恢复默认target、改为实际snap内部render包围查询后GL0。不得把该无效复放计时作为生产测量。
- 图鉴真实点击确认277总条目/黑洞11，点击Sagittarius A*后modal关闭、bhActive=true/key=sgra。实际滚轮改变目标距离。整体新盘面仍待用户反馈；自动截图仍受Temp权限阻止。

## HDR兼容与接缝验证（round 27）

- bhResize检测color-buffer扩展并检查半浮点FBO完整性，失败时恢复前target、销毁失败RT并退到UnsignedByte线性base/无bloom（高光动态范围较低，仍保留单次ACES/gamma）。`?bhHDR=0`可强制兼容路径。
- actual bhResize VM测试支持/无扩展/FBO不完整/抛异常/强制降级、同尺寸复用、resize全释放与target恢复。真GPU强制LDR：hdr=false/bloomActive=false、type1009、2pass、bloomUniform0、中心纯黑/GL0。正常HDR：type1016/7pass、中心纯黑/GL0。同会话关辉光后2pass/uBloomK0，再开成功。
- 使用实际disk() GLSL编译微型2×64 probe，采样phi=+-pi两侧、r3.2–15及不同t，RGBA最大字节差0、非零样本188、GL0；证明角度接缝连续，不等同于整体审美。
- 正式`/space.html`（内联HTTP构建）浏览器验证268目录、新turbulence/无旧stripe、hdr=true、中心纯黑/GL0。正式入口已重建，SW gas-r5。

## 输入、重入和竖屏回归（round 28）

- 实际pointer drag工具虽返回user-activity撤销，但同步后业务状态确认az=-1.08/inc=.235、dragging=false，符合180×30px拖动；未盲目重放。Escape实际按键成功退出，BH=false/cosmos=false。
- 8次sgra/m87bh交替enter/snap/exit、70/.52与220/.9交替质量、正负.02倾角：每次中心纯黑/GL0，资源23 geometries/26 textures稳定，退出未误入cosmos；无效key=false。
- 修复非主按键启动orbit，以及enter/exit未清dragging的边界。actual bhInput VM覆盖主按键、HUD、拖动/释放、blur/pointercancel、zoom/inc限位、零倾角、DEEP所有权与Escape。测试文件换行已归一，CRLF不是功能失败。
- 正式新构建iphone14模拟390×844 CSS、780×1688 buffer：HDR active、中心黑/GL0、退出按钮完整在视口内。并非真iPhone Safari/触摸设备性能证明。
- 正式三入口重新构建，SW gas-r6；新气体整体视觉仍未验收，截图Temp仍拒绝。

## 长期差速纹理修复（round 29）

- 原ang=phi-om*t无限累积剪切，长期会把噪声拉成径向高频。改两组相差6s、寿命12s的gasNoise包；用cubic smoothstep三角权重，在包重置时权重及一阶导为0。noise坐标仍方向域连续。足迹乘每包1+3.9*om*age的保守剪切伸展，并新增宽尺度淡化。
- 这是有12s周期的艺术有限寿命流，非持续演化MHD。两组采样提高盘交点噪声成本；没有更改光线步数预算。CPU代数测试覆盖重置C1、带宽上界与24h边界。原始raw t=86400±.001s在float中相同，原GPU探针该点不能证明连续性，已撤回该点结论。
- 精度修复：CPU以double先对BH.time取%12再上传uTime；grain也已有12s周期。新增Math.fround回归证明raw24h±.001无法区分、bounded上传能区分；actual disk GLSL重测raw0/6/12/600/3600/86400±.001经过CPU wrap后的float，两侧全部不同，2×64 probe最大RGBA跳变1字节/GL0，正式页面uTime在[0,12)。不是等待一天的端到端耐久测试。正式入口重建与回归通过，SW gas-r8。
- 新GPU全7pass单样本四档0.562/0.776/2.072/2.078ms，disjoint=false/GL0；和此前5–11ms采样波动很大，不将其宣称性能提升，也不当成FPS。清理查询/临时RT并恢复默认画质。
- 三正式入口已重建，SW gas-r7；实际正式HTTP入口再次确认bounded shader/7pass/HDR active/中心纯黑/GL0。源契约、输入/HDR实际函数VM、CPU有限性/收敛、生命周期、atlas/API、inline/built全部通过。整体新盘面视觉仍待截图或用户观感确认，目标未宣称完成。

## 已实现

- 吸积盘：外缘扩到16 Rs，采用差速旋转、双有限寿命包平滑交替与无角度缝隙的方向域噪声，减少原来单纯橙色噪点/细丝；内缘rim、径向温度和暖白到琥珀色层次增强。
- 盘面集束：加入有限gamma的局部圆轨道速度近似、观察者参考的引力红移和有界频移shift，作为电影化相对论不对称；明确不是完整Schwarzschild/Kerr发射四基底辐射输运。
- 引力光线：硬循环统一到400步，保留uSteps质量档预算；改一阶kick-drift为带曲率步长限制的midpoint RK2，盘面交点包含边界保护。
- 真实阴影：只有确认逃逸的光线采样背景星空；未完成/捕获光线不再泄漏任意背景。删除无条件绘制的假光子环；环和后弧只能来自光线实际穿越吸积盘。
- 暗部：胶片颗粒按线性亮度门控，不再向黑洞视界注入可见噪声；收紧暗角。
- UI标注：`BLACK HOLE · CINEMATIC SCHWARZSCHILD APPROXIMATION`，说明“电影化吸积盘 · 非该天体实拍 · 非旋转 Kerr 精确解”；`enterBlackHole`拒绝非类型6记录。
- BUILD/sw改为v230-cinematic-black-hole。

## 真实性边界

这是可实时运行的 Schwarzschild 近似/电影化显示，不是《星际穿越》Gargantua 的旋转 Kerr 辐射输运，也不是每个目录黑洞的实拍。当前仍为零厚度盘面交点、人工黑体色阶、近似Doppler/红移和手写ACES；虽已加入半浮点HDR和有限辉光后期，但不是MHD磁流体或完整Kerr喷流。入口原有黑洞贴图仍只用于宇宙层小标记，特写采用独立逐像素shader。

## 最新补充（round 26）

- 黑洞图鉴不再使用SQL里误配的球状星团照片或“超高清”按钮；改为明确标记“符号示意 · 非实拍”的目录图标，点击进入实时特写。与实际黑洞shader中的光线环不同，目录图标仅用于识别。
- `tools/test-blackhole-numerics.cjs`补capture/escape/exhaustion分类、h²=b²的impact参数、旋转不变性、步长细分方向收敛和角动量漂移上界。b=3/4/8时半步相对四分步方向误差比原步小约4.7–4.9倍；原步b=3方向差仍约0.096，说明是有误差的实时近似，不能声称精确GR。
- actual atlas IIFE验证BH卡片无background-image/无HD按钮、分类和sgra/m87bh直接路由；268/11BH live API与SQL逐记录相同。正式三入口已重建。

## 验证

- `node --check public/js/app.js`通过。
- `tools/blackhole-cinematic-v230.cjs`检查RK2/逃逸门控/暗影颗粒/无假环/吸积盘结构/UI guard通过。
- solar-optics、solar-overview、sun-sphere12、main、cinematic-inline、built通过，三正式入口已重建。
- BrowserSkill后续已连接，实际WebGL2/ANGLE编译通过，getError=0。GPU为NVIDIA RTX 4060 Laptop。默认中心RGBA=(0,0,0,255)，上方采样=(133,97,58,255)，左/右采样=(60,64,74,255)/(196,197,197,255)。只证明采样点，不能替代整体画面验收。
- 默认、竖屏494×762和超宽1778×562 CSS视口均绘制成功，中心黑/getError=0。实际退出按钮成功，主场景来源退出后cosmos.active=false；6次重入绘制/退出资源保持22 geometries/17 textures。无效key返回false；bhSet零倾角已夹到0.02。
- EXT_disjoint_timer_query_webgl2有效（disjoint=false）：3次暖机、12次重复render均值，70/.52→1155×365约0.453ms；110/.64→1422×449约0.822ms；160/.75→1667×527约1.003ms；220/.9→2000×632约1.518ms。只计黑洞光线pass，不包含最终blit/UI/其他场景，不等于FPS。此前snap路径36–41ms包含截图编码，不应当作shader耗时。
- 自动截图因Windows Temp写入被拒绝，尚未得到整体画面；用户随后报告图鉴只剩本地天体。根因为Node轻量server缺/api/objects，public/index没有内联深空包，失败后仅余9本地条目。已补SQL同源分页接口（268条/11BH），独立黑洞分类，卡片直接enterBH；静态IIFE与live API通过，正式入口重建。刷新后真实UI点击待重连确认；不宣称整体电影级视觉已验收。
- 额外补充：`tools/test-blackhole-cinematic-v230.cjs`通过源shader契约、GLSL括号/main/400步预算解析与CPU midpoint-RK2有限性oracle（真实变化的impact parameter b=2.5/2.598/2.7/3/4/8、dist/倾角组合）、build/sw/UI guards和三正式入口当前片段parity；index/space/space-http内联一致性、三入口构建检查均通过。修复GLSL反向smoothstep（sky两处与vignette），默认盘16/.62/曝光1.02，退出仅在存在BH.back时恢复原宇宙层，edge-on拖拽和动画帧都会避开零倾角奇异。黑洞交互增加HUD按钮命中保护、pointercancel/blur释放拖拽、pointer capture和bhMeta换行显示。
