# v207 GPU复验交接

状态：未完成最终画质验收。第5–8轮BrowserSkill连接持续不可用；旧截图不是fresh正式入口复验。

## 已有证据与边界

- 当前构建标识 `v207-filtered-dust-light`。
- 离线入口 `space.html` / `index.html`：110482586 bytes；SHA256 `4908d2cc01cd1ae73da8f2526d1a6814e31dbf072af5ec5d851b96e80a7fa413`。
- HTTP入口 `space-http.html`：25864658 bytes；SHA256 `91df4fdda0fb24fbf2c8f1ccea98b68e71a314b99a327bec1d0f58395cf17a10`。
- 已有GPU照片 `.workbuddy/v207-quality/orion-filtered-gpu.jpg` 和 `pillars-filtered-gpu.jpg`，以及同机位v206/v207对照。照片来自v207 shader真实GPU运行，但发生在最后LUT优化/diagnostics重新构建之前。
- 该缓存修正仅增加光照连续性。当前256³medium及128³light仍限制真实细丝；不声称电影级验收完成。
- M51是ESA/Hubble照片引导的艺术厚度体积，不是实测三维重建；`sqrt-UNORM`先插值后平方的偏差已量化，尚未修改传输。
- 方向缓存仍为128³ RGBA8、8MiB、一次texture fetch。源双oct通过原始SHA后运行时转码为Cartesian incoming RGB + bounded response A。无额外GPU oct副本。

## 恢复条件

用户打开BrowserSkill扩展，确认显示connected。只使用BrowserSkill Agent Window，不用CDP、其他自动化后端或软件截图冒充GPU。

## Fresh验证步骤

1. 在仓库运行 `node server/server.mjs --port 8173`；记录managed job id并在验证后停止。
2. high入口：`http://127.0.0.1:8173/space.html?auto=0&q=high&fresh=1&tour=0&ts=0`。
3. Agent Window加载完成、sync后检查 `__SE.build` 为 `v207-filtered-dust-light`。
4. `__SE.enterNebula(0)`、`__SE.bloom(false)`；等待 `__SE.main3DInfo()` 的 cinematic.ready=true、asset=6、size=256、steps=320，streaming.errors为空。
5. 查看 `ORBIT_CINEMATIC_ASSETS.status().diagnostics`：type6的shadingEncoding为 `incoming-cartesian-response-unorm8`，shadingTranscodeMs有限且非负。检查 `__SE.renderer.getContext().getError()` 为0。
6. 同机位保存 `__SE.shot(1000,700,'image/jpeg',{gradePhase:0}).url`，用read_image实际看图。检查尘埃不是发光实心球、薄壳没有明显规则栅格、恒星未穿透厚尘埃。不要仅从GL0或测试通过判电影级。
7. `__SE.enterNebula(1)`复验Pillars/type9；分别记录ready、encoding、timing、GPU byte budget和截图。检查金色边缘与暗尘埃之间是否仍有真实对比，不能靠Bloom掩盖。
8. 新low入口 `?auto=0&q=low&fresh=1&tour=0&ts=0`，复验step=128，非空图像和GL0。新ultra入口同理step=448。质量档位是积分预算，不是下载体积尺寸的自动降级，不要误报为低分辨率资源包。
9. 新入口加入 `&cineVolume=0`，确认高级体积未启用、基础解析示意仍可用；也从设置中的高质量体积开关确认关/开能恢复，不增加损坏资源或dispose错误。
10. 宇宙导航中定位M51，或使用项目已有debug入口 `__SE.cosmosGo('M51')` 后检查其返回实际命中名称。若无匹配，检查目录/UI，不猜API成功。M51应为type13，medium512×64×512，无shading；方向缓存修正不该误套在该体积上。
11. 检查M51图像引导体积标识/许可说明仍在，开启统计成员示意必须有非实测位置badge；默认不应出现统计白色点团。
12. 对HTTP外置资源入口重复至少一个hero smoke，检查不返回HTML作为gzip、hash错误或shader compile错误。
13. 记录浏览器/GPU、viewport、步骤、截图、console、ready、timing和构建SHA；停止Agent Window和managed server。截图事务含JPEG编码时间不可称为纯GPU帧时。

## 非GPU回归命令

```
node tools/test-filtered-shading.cjs
node tools/test-emission-transfer.cjs
node tools/test-cinematic-volume.cjs
node tools/test-cinematic-streaming.cjs
node tools/test-main-redesign.cjs
node tools/test-cinematic-inline.cjs
node tools/check-built-content.cjs
```

损坏fixture的 `Decoded volume integrity mismatch` 是预期负例；需要看整体exit code为0。以上均不等于fresh浏览器GPU验收。

## 后续真正提升细丝的工作

不要把修复传输偏差、锐化或高频噪声叫新增细节。当前作者域边长2.6，256³ spacing=0.01015625，Nyquist约49.23 cycles/local；74频率噪声和非线性窄脊已超出可靠解析范围。下一代medium应采用带限作者场、体素足迹过滤或真正多尺度clipmap/稀疏细节，配套显存预算、同机位GPU对照和新资产许可说明。
