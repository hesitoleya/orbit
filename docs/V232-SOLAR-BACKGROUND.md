# v232 r4 太阳系背景：尘带层次与实际分辨率

## 本轮问题与修复

真实GPU帧确认：r1天幕是一根笔直、过亮的蓝灰色光柱，均匀点噪较重；原后缓冲1047px宽而CSS视口约1258px，存在低分辨率放大。

- 将直线高斯亮带改为方向域三尺度噪声控制的宽窄变化、弯曲、团块以及中央吸收暗裂隙；低饱和中性色，不再用规则正弦条纹。
- 保留星表方向与现有银河星场的一致性；不再宣称与太阳系黄道坐标完全物理对齐（项目存在历史赤道/黄道框架不一致，本轮未跨全景重构）。
- 银河辅助星点基础opacity .25、均匀暗星.32、星芒.58。捕获userData.skyOpacity，每帧只乘可见度/特殊场景增益，修复原逐帧覆盖初始透明度的错误。
- 背景窄核心贴图只供buildStars使用，行星/系外恒星makeStarTex默认形态不变。
- 太阳系全景（主场景、alt>=1e10、无BH/NEB/EXO）设原生CSS像素DPR下限1；高DPR不被强制降低，地球/宇宙/特殊场景恢复原策略。代价：低画质原.68~.85倍时，全景像素负载会上升；不保证所有设备帧率。
- 截图事务内不触发场景分辨率切换，防止覆盖显式导出尺寸。
- uAtmoEnabled在距离地球>=3e9m时跳过整条地球球交、march及月夜光，避免远距float32大数相消；关闭uSolarBand时跳过尘带噪声。
- 新天幕对NEB（包括active=0）、EXO、BH、cosmos关闭。移除了方向不可靠的假黄道条带和地球→太阳误作相机→太阳的辉光。

## 真实画面证据

- `solar-bg-before.png`：r1 GPU帧，1047×584，直亮柱、密集均匀点噪。
- `solar-bg-r4.png`：正式r4 GPU帧，1258×662，DPR1，中央暗裂隙、不等宽低亮尘带，暗星噪点降低。
- 这些不是同机位严格像素A/B：采样时间和画布大小不同、旧辅助银河点使用Math.random初始化。只支持形态与清晰度方向比较，不支持定量优劣结论。
- 原生BrowserSkill screenshot/download受Windows Temp写权限阻止；最终通过页面既有__SE.snap同步渲染→BrowserSkill返回保留JSON→解码PNG获得实际帧，未修改Windows权限。

## 浏览器验证（正式space.html?review=solar-bg-v232-r4）

- 太阳系：后缓冲1258×662，renderer DPR1，uAtmoEnabled=0，uSolarBand=.92，GL error0。
- 实际材质逐帧值：[1,1,1,1,1,1,.25,.32,.58]，基础值与运行值一致。
- Shader诊断：runnable=true；仍有现存gradient instruction in varying loop警告，未冒充无警告。
- 显式800×450导出：解码PNG实际800×450，meanRGB3.327、brightPixels8668（RGB和>90）；前后画布1258×662、DPR1一致，screenshotDiagnostics无restoreErrors/recoveryRisk，GL0。
- 点击地球：focus地球、alt9500000、atmo1、DPR.85、warp false、GL0。
- 地球→银河系：cosmos active、DPR.85、GL0。
- 银河系→太阳系：cosmos inactive、alt6.6e12、atmo0、DPR1、warp false、GL0。

## 回归与构建

- JS语法、test-solar-background-behavior.cjs、test-solar-background-v231.cjs、test-navigation-contract.cjs、test-cinematic-inline.cjs、check-built-content.cjs全部通过。
- 行为测试实际提取helper/skyMat/分辨率入口，覆盖透明度恢复、特殊场景、远距大气、GLSL顶层函数、噪声开关、原生像素下限与截图保护。不是只搜关键词，也不替代GPU。
- 额外跑历史test-deep-adaptive-v193.cjs：17PASS/1FAIL。失败点仍寻找v199已退役的bindDeepModels独立面板入口，属于历史集成契约失效；未恢复废弃UI来掩盖失败。
- 最终三入口重建通过。space/index SHA256 `1b8576a4b112239624b8eb5983d834632a303fbf9d2d8f14f01befdb1b1640fe`；HTTP `573b95b67293366cdbefa3bb21bc7be0ef2273b4ba733b240d862d02b4b7240c`。
- SW版本space11-v232-solar-background-r4。

## 边界

背景仍为艺术程序化近似，不是实拍全景或精确银河辐射传输。太阳、行星真实尺度下在44AU全景非常小，本轮不通过放大实体破坏尺度。轨道辅助线仍属于图示层。移动真机/高DPR4K与长期GPU性能未覆盖；黑洞/星云未逐个视觉复测，本轮用场景隔离回归保护路径。整体满意度仍需用户直接看正式页面确认。
