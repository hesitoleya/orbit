# v240 — 太阳系观测图与太阳滤膜色

> **本版的行星近景做法已被 v241 取代**：v240 把观测图正交投到球的前半球，
> 观感是「弯起来的纸 + 背面空洞」，用户明确否掉。v241 改用全球等距圆柱图铺满
> 整颗球并支持拖动旋转，见 [V241-PLANET-GLOBES.md](V241-PLANET-GLOBES.md)。
> 本文保留作为历史记录；`tools/test-v240-planet-observations.cjs` 现在只守住
> 「图鉴里的任务观测照片与来源记录不丢」这一条。

## 变化

- 地球保持现有卫星影像地形渲染。
- 金星、火星、水星、木星、土星、天王星、海王星在近距离可解析时使用图鉴中的真实任务观测图投影到可旋转的三维球体表面；这不是把图片放在相机前的平面卡片。图片只投影到可见前半球，黑背景透明丢弃，金星裁掉观测图中间分隔线右侧的第二面板。
- 远距离或图片尚未加载时保留原程序化球体作为LOD后备；图片加载后近景图层替代程序化球和程序化环，避免双重轮廓。
- 土星观测图为完整 Cassini 行星+环构图，图层宽度按约4.96个行星半径设置，因此外环约2.48R，不再是原先只有2.27R的几圈小环。它仍是二维观测构图，不能声称从单幅照片得到环的三维粒子密度。
- 月球接入 NASA SVS 4720/LROC WAC 2025 Hapke-normalized 2:1颜色图 `lroc_color_4k.jpg`；保留已有月球几何与光照，颜色由观测地图约束。来源限制见 [moon-lroc-4k-source.json](../public/data/moon-lroc-4k-source.json)：这是视觉优化地图，极区含低分辨率填补，并非科学高程/光度产品。
- 太阳继续使用已内嵌的 Solar System Scope/INOVE 发射纹理（不是把单幅SOHO EUV prominence冒充光球），新增暖色薄膜滤镜 `(1.06,0.94,0.80)`，让白球呈现透过有色薄膜观察的太阳观感。图鉴SOHO图仍明确标为EUV伪彩观测。

## 打包与测试

- `build.mjs` 将月球JPEG内联为 `moonLroc`，HTTP模式回退到 `data/lroc_color_4k.jpg`；Service Worker缓存WebP并升至 v240。
- `space.html` 与 `index.html` 已由 `node build.mjs --replace-existing` 重建；离线约147877KB，HTTP约25482KB。
- 通过 `tools/test-v240-planet-observations.cjs`、`test-atlas-photographs.cjs`、`test-cosmic-depth.cjs`、`test-cosmic-population.cjs`、`test-gaia-built.cjs`及语法检查。
- 这次新增图层的实际浏览器GPU验收仍需连接浏览器后，在月球与各行星近景分别检查GL错误和照片层显示；CPU/源码契约已通过。
