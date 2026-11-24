# v233 实拍银河全景

## 采用的照片

- ESO/S. Brunier, eso0932a — https://www.eso.org/public/images/eso0932a/
- 下载 https://cdn.eso.org/images/large/eso0932a.jpg
- CC BY4.0 https://creativecommons.org/licenses/by/4.0/ ，官方政策 https://www.eso.org/public/outreach/copyright/
- 原始JPEG6000×3000，8228817字节，SHA256 `60400c92c54b7c1bd12299c69e83b16e5b6256e7dabacc478c021758ecd28179`。
- 全天球长曝光摄影拼接，覆盖南北天球，不是外视银河想象图。公开版本为6K而非8K；未公开800MP原版不在本项目中。页面显示完整署名、源链接、CC BY4.0链接与曝光/重投影修改说明。原JPEG不做再编码。

## 实现

- skyMat方向域采样实拍2:1全天全景，完全删除v232的程序化尘带噪声/暗裂隙生成。uPanoramaReady就绪前只显示原星表，不拿假银河冒充照片；30秒超时/加载失败明确提示，刷新可重试。
- 银心向量正交化，银北极为纵轴。Orbit世界轴为(eqX,eqZ,eqY)，east=cross(center,north)，u=.5-l/(2pi)，v=.5+b/pi，默认flipY=true。RepeatS/ClampT、sRGB解码、mipmap及最多8倍各向异性过滤。
- 原片6000×3000，设备maxTextureSize不足时同比缩到上限（例如4096×2048），不伪造更高原生分辨率。
- 全景已含暗星与星云：synthetic银河点/均匀暗星/星芒在photoGain1时为0；独立星表降为.18用于微弱核心，LMC/SMC/M42等原天球照片叠层亦归零，避免重复。
- 太阳系远景DPR>=1策略沿用；实拍全景时关闭旧后期横向色差（仅主场景太阳系远景），避免边缘星点RGB重影。地球近景、BH、宇宙仍原后期路径。
- 各特殊场景与大气高度门控保留。非主场景/BH隐藏全景署名提示；回太阳系恢复。
- 构建：space/index离线内联原JPEG；space-http不内联而走相对资源；SW缓存项含全景。离线约121.5MB（原约110.5MB，增量约11MB为base64）；在线入口约25.9MB，全景另约8.2MB。GPU RGBA8含mip约96MB，低端设备成本需注意。

## 投影与物理边界

原图为银道坐标360°×180°近等距柱状全景，天体标志位置验证：LMC/SMC右下，M31左下，Pleiades左缘下，Orion右下。ESO未给此公开JPEG的WCS；独立HNSKY文档 https://www.hnsky.org/toast_pr.htm 记录约1°级畸变。不宣称高精度星图配准。现有星表赤道世界框架与太阳系黄道框架未做全局统一。

照片长曝光呈现密集恒星与彩色星云，不等于肉眼/物理亮度，也不是真实太阳附近当地曝光。素材拍摄期间太阳系天体曾经过星场；未做科学测光式移除。不得把此摄影背景当实时天空观测。

## 真实浏览器/GPU证据

- 源码预览 `http://127.0.0.1:8194/index.html?review=real-mw-v233-source`：外部相对JPEG加载就绪，6000×3000、DPR1、GL0、nebMax0；图片见solar-real-mw-v233-final.png（1258×662）。旧CA彩边已去除。
- 现有8194服务器/space.html实际映射轻量入口（inline0），不是磁盘同名单文件；/space-http.html为404。未把该路由冒充离线验证。
- 真正离线 `file:///D:/WB/orbit/space.html`：inline10971756字符、全景外部请求0、ready6000×3000、实际1572×827、GL0。已渲染截图并查看solar-real-mw-v233-offline.png。
- 网页800×450导出解码尺寸正确，前后画布1258×662/DPR1不变，restoreErrors[]/recoveryRisk false，GL0。
- 太阳系→银河系：cosmos true、署名hidden true、DPR.85、GL0；银河系→太阳系：cosmos false、photoReady true/gain1、署名可见、DPR1、warp false、GL0。
- 截图通过既有__SE.snap→BrowserSkill保留JSON→本地解码原PNG，不修改系统Temp ACL。截图仅WebGL内容不含DOM署名；展示截图时需附ESO/S. Brunier署名。

## 回归与最终构建

全部通过：

```
node --check public/js/app.js
node tools/test-sky-panorama.cjs --built
node tools/test-solar-background-behavior.cjs
node tools/test-solar-background-v231.cjs
node tools/test-navigation-contract.cjs
node tools/test-cinematic-inline.cjs
node tools/check-built-content.cjs
```

新测试实际提取loader/credit helper/panoramaUV/opacity/post表达式，覆盖成功/4K缩放/错误/超时/迟到回调、UV方向/极点/接缝、无合成回退、照片重复层抑制、CA场景隔离。离线JPEG逐字节及SHA256与源相等，HTTP inline字段空。VM/CPU不是GPU替代，GPU证据如上。v232记录的历史DEEP测试退役契约问题未在本轮重跑/修复。

最终space/index SHA256 `2537a3231caa4d4ac7383482c21383608f44ba247cb4ced02967312f1f096c26`；space-http `23a8abe0ff82ca04a49360ffa99eff0885892eb5b1ffc1abb5245c3e254060d5`。SW版本space11-v233-observed-panorama-r1。

未覆盖真移动设备、全景极区所有机位逐帧视觉、长期性能或全部特殊场景视觉回归。星表核心只弱叠加，未保证逐星亚像素配准。
