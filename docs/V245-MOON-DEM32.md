# v245 — 月球 32 ppd 真实高程（LDEM_64）

v244 的建议里排第 1 的就是这件事，这一版按计划做完。

## 数据链

| 步骤 | 做法 |
|---|---|
| 源 | PDS `LDEM_64.IMG`，23040×11520 **int16**，473.8 m/px，11520 行 × 46080 B ≈ **506 MB** |
| 下载 | 8 路并行 Range 请求（实测 66 s / 506 MB），按整行切分片 |
| 降采样 | 2×2 平均 → **11520×5760（32 ppd，0.95 km/px）** |
| 单位 | LDEM_64 的 int16 是**半米**（标签 `SCALING_FACTOR=0.5`，MAX 21546 = 10773 m），转成整米 |
| 经度 | PDS 从 0° 起算、我们从 −180° 起算 → 平移半个图宽（正好是两张切片的互换） |
| 编码 | 行内一阶差分（相邻像素高度连续）→ gzip：108 MB 降到 **74 MB** |
| 前端 | `DecompressionStream('gzip')` → 差分还原 → 转半浮点 |

## 一个必须解决的硬件限制

11520 宽超过不少 GPU 的 `MAX_TEXTURE_SIZE`（实测本项目的 SwiftShader 环境就是 **8192**）。
所以纹理按经度劈成两张 **5760×5760**（每张 66 MB，R16F）：

```glsl
float demTex(float side, vec2 p) { return side < 0.5 ? texture2D(uDemA, p).r : texture2D(uDemB, p).r; }
```

`u<0.5` 取第一张、否则第二张；局部 u 是全局 u 的两倍，一个全局 texel = `2/uDemW`。
接缝处只差一格（用 clamp 处理），实测在处理后的画面里看不出来。

## 加载策略

- **只在贴近月球时**（`cam.alt < 3.2e6`）才下载 74 MB，首屏完全不受影响；
- `file://` 离线单文件不发这个请求（离线仍是 8 ppd 内联）；
- `MAX_TEXTURE_SIZE < 5760` 时直接放弃并记录原因，不会把画面搞坏；
- 纹理就位后，几何从 1280×640 重建为 **2048×1024**（2.7 km/顶点），
  放在下一帧执行，避免卡住当前帧。

## 效果有多真实：实测而不是形容词

同一机位、同一光照，`uDemSplit` 开/关（32 ppd vs 16 ppd）在 1072×482 窗口下：

- 平均绝对差 **1.75/255**，p99 **19/255**；
- 差异全部集中在坑缘与斜坡（见 `v245-dem32-vs-16ppd-diff4x.png`，放大 4 倍），
  **没有大片条带** —— 说明两套数据的经纬度对齐是正确的（错位会表现成整体带状差）。

结论要直说：**在 1080p 窗口里这 74 MB 换来的差别很小**（16 ppd 的 1.9 km/px 已经细于屏幕像素）。
它的价值在 `__SE.shot(3840,2160)` 这类静帧：4K 时每像素只覆盖 ~0.9 km，
16 ppd 就变成瓶颈，32 ppd 刚好补上。

> 4K 的实拍对比没能在本机拿到：SwiftShader 软渲染一张 2560×1440 的月面帧超过 8 分钟，
> 被工具超时杀掉。上面那组 1080p 的数值差是真实测得的，4K 的收益是几何推理，
> 这一条写清楚，不当作已验证。

## 文件

- `public/data/moon-ldem32.d16.gz`（74 MB，差分 + gzip，HTTP 模式懒加载）
- `public/data/moon-ldem8.bin`（8.3 MB，离线内联，保留）
- `public/data/nasa-svs4720-ldem16-uint16le.bin`（33 MB，HTTP 首选的 16 ppd）
- 中间产物 `moon-ldem32-raw.bin`（132 MB）已删除，可由脚本重新生成

## 验证

- `tools/test-v245-moon-dem32.cjs`：资产大小/魔数、解包链路、切片尺寸、`MAX_TEXTURE_SIZE` 守卫、
  离线守卫、懒加载条件、着色器双分支与中心差分、几何 2048×1024、SW 不预缓存 74 MB。
- 实际浏览器（HTTP）：`__SE.moonDebug().dem` → `{hi:true, hiLoading:false, hiError:null,
  verts:2100225}`；近景帧 `v245-dem32-close.png`，无接缝、无块面。
- 离线（`file://`）：`dem.hi:false, hiError:null`（默认机位不在 3.2e6 m 以内，压根没触发），
  控制台干净。
- 回归：v241–v244 契约、atlas / cosmic / gaia 打包回归全部通过；三个入口已重建。
