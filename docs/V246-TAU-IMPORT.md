# v246 — 实测 τ 剖面：从哪下、怎么接

## 一、下载地址

主站是 **PDS Ring-Moon Systems Node**（`pds-rings.seti.org`）。三个入口对应三种用法：

| 用途 | 地址 |
|---|---|
| 数据集说明页（先看这里，含 Colwell et al. 2010 的方法） | https://pds-rings.seti.org/cassini/uvis/ |
| **在线浏览**（只想拿一条剖面，推荐） | https://pds-rings.seti.org/viewmaster/volumes/COUVIS_8xxx/COUVIS_8001/ |
| **整包下载**（438 MB，200+ 次掩星、1 km 与 10 km 两套剖面） | https://pds-rings.seti.org/holdings/archives-volumes/COUVIS_8xxx/COUVIS_8001.tar.gz |

同一张页面上还有两个更轻的替代：

- **Voyager PPS**：`VG_2801` tar.gz，约 **75 MB**（1 km 剖面，1979–81 年数据，标定较老但同样是实测）；
- **Cassini UVIS 太阳掩星**（PDS4，2017 年止）：https://pds-rings.seti.org/pds4/bundles/cassini_uvis_solarocc_beckerjarmak2023

> 本机下载不了不是权限问题：这台机器/代理的出口 IP 被站点的 Anubis 按 IP 拒绝
> （`Access Denied: error code bacf8917…`），换住宅网络用浏览器打开上面的地址即可正常下载。

## 二、挑哪一条剖面

整包解开后是 `COUVIS_8001/DATA/` 下一堆 `.TAB`（数据）+ 同名 `.LBL`（标签）。
选的时候看三件事：

1. **恒星仰角高**（B ≳ 50°）。仰角低时环里的自引力尾迹会让 τ 偏大，同一半径不同仰角能差 20% 以上；
2. **1 km 分辨率**优先（文件名/标签里通常带 `_01KM`）；
3. **完整覆盖** 1.11R–2.33R 的入环（ingress）或出环（egress）都可以，缺的段脚本会线性插值。

`Cassini_UVIS_Ring_Occultation_Atlas`（document 目录里的 PDF）列了所有掩星的恒星、rev、覆盖半径范围与仰角——按这张表挑最快。

## 三、接进来（一条命令）

```bash
node tools/import-couvis-tau.cjs "D:/data/COUVIS_8001/DATA/xxxx_01KM.TAB"
```

脚本做的事：

1. 读同名 `.LBL`，按 `START_BYTE`/`BYTES` 取出固定宽度列（找不到列定义就退化成按空白/逗号分隔）；
2. 找名字含 `RADIUS` 和 `TAU` 的列（跳过 `TAU_MAX`）；
3. 把 1.110R–2.330R（R = 60268 km）切成 **2048 格**，每格取中位数；
4. 空格（掩星没扫到的半径）沿两侧线性插值；
5. 写出 `public/data/saturn-ring-tau.json`，带 `source / rows / samples / filledBins` 记录。

然后刷新页面，`__SE.ringTau()` 应返回：

```json
{ "applied": true, "source": "xxxx_01KM.TAB", "samples": 14705, "error": null }
```

渲染上只替换环 LUT 的 **τ 通道**——反照率仍按环区给，因为掩星只测光深、不测颜色。
文件不存在时静默跳过，继续用公开环区数值；离线单文件不请求这个 JSON。

## 四、已经用真实数据跑通（2026-11-23）

用户把 `COUVIS_8001.tar.gz`（438 MB）下到 `D:/WB/orbit/data` 后解包（2.3 GB，277 条 1 km 剖面），
筛选条件是「质量 GOOD + 仰角高 + 覆盖 1.11R–2.33R 全程」，命中：

```
UVIS_HSP_2008_210_BETCEN_E_TAU01KM.TAB
  β Cen（全天最亮的 UVIS 掩星目标之一） · EGRESS · 仰角 67° · DATA_QUALITY_SCORE = GOOD
  半径 58,469 – 145,024 km（完整覆盖 D 环到 F 环）
```

导入结果：

```
行 86,553 | 有效样本 65,985 | 缺失值跳过 12,216 | 有值格 2,028 / 2,048
区段平均 τ：C 0.106 · B 3.848 · 卡西尼缝 0.110 · A 0.668
τ 范围 0.000 – 8.538
```

对照公开的环区量级（C≈0.1、B 1–5、卡西尼缝≈0.1、A 0.5–1），数值对得上——
说明列选择、单位、径向映射都没错。`__SE.ringTau()` 返回
`{applied:true, source:"UVIS_HSP_2008_210_BETCEN_E_TAU01KM.TAB", samples:65985}`。

同机位 A/B（`docs/v247-tau-ab.png`，上=实测、下=解析）：B 环更不透明、卡西尼缝边缘更利，
A 环内部的多层结构变成实测的样子；差异都在该有差异的地方。

> 踩到的两个坑，写在这里免得重复：
> 1. `.TAB` 其实是**逗号分隔**，标签里的 `START_BYTE` 对不上——按固定宽度切会算出一堆
>    20–50 的「τ」（其实是别的列），后来改成先探测分隔符；
> 2. 光深列名是 `NORMAL OPTICAL DEPTH`（不是 `TAU`），旁边还有个
>    `MAXIMUM DETECTABLE NORMAL OPTICAL DEPTH` 必须排除。

## 五、合成数据的验证（保留作回归）

本机拿不到真数据，所以用一个**合成的 PDS3 TABLE**（15001 行、10 字节固定宽度列、
B 环 τ 到 4.1）跑通了全链路：

- `tools/test-v246-tau-import.cjs`：解析 → 重采样 2048 格 → 无空格 → 数值范围保留 → 交付目录里不留合成文件；
- 实际浏览器：把合成结果放进 `data/`，页面启动后 `__SE.ringTau()` 返回
  `{applied:true, source:"fake.tab", samples:14705}`，土星环照常渲染
  （B 环、卡西尼缝、行星影、环影都在）；
- 验证完已把合成文件撤掉——**交付目录里不会留下任何"看起来像实测"的假数据**，
  测试里也钉了这条。

## 六、拿到真数据后建议顺手做的两件事

1. 在 `docs/` 里记下：用的哪条剖面（恒星、rev、仰角、分辨率），因为 τ 是仰角相关的；
2. 有了实测环脊，才值得去做密度波——那时共振位置可以对到真实的环脊上，
   而不是按解析图案去摆（v245 里算过：纯解析的密度波波长 10–100 km，
   在 150 km/px 的近景下是亚像素，加了只会出摩尔纹）。
