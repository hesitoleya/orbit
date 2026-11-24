# v223 固定颗粒相位与硬件计时

## 修正v222测量缺陷

renderFrame已有options.gradePhase固定颗粒功能，但v222主动probe未使用；正常路径每次uGradeT+1，导致off/off也有5色阶差。v223仅诊断renderActiveFrame传gradePhase:0，普通动态画面不变。

## GPU像素对照

BrowserSkill qdgp，8184，v223，RTX4060 Laptop/ANGLE D3D11，1258×662。control=off/off，test=off/on，reverse=on/off：

|R/视角|control changed/max|test changed/max|reverse changed/max|GL|
|---|---|---|---|---|
|2e21/.7/1.1|1/1|2/1|2/1|0|
|2e21/1.8/.4|0/0|0/0|0/0|0|
|2e22/.7/1.1|0/0|0/0|0/0|0|
|3e23/.7/1.1|0/0|0/0|0/0|0|

首行少数1色阶差控制组也存在，不能宣称全部字节严格一致；总体说明此前广泛5色阶差主要来自颗粒相位。

## EXT_disjoint_timer_query_webgl2

新增cosmicGpuTimer(1..6)：开始query→固定相位主动render→结束query；最多等90rAF，检查available与GPU_DISJOINT，finally删除query，拒绝已有active query。不是将finishInclusiveMs冒称GPU时间。

同一876×461画幅，交错off/on/off/on，每组3样本，全valid/gl0：

- R2e21 off第一组166.181/133.577/133.214ms，on133.419/133.564/133.357ms；off第二组133.247/166.271/100.231，on133.549/133.427/133.114。
- R2e22第一组off7.629/7.658/2.856，但后续off100.257/100.201/132.747；on99.963至100.166且有1.722异常快样本。
- R2e25（没有可见解析体积）多数样本约133ms；off第二组133.574/133.451/133.386，on133.000/133.253/133.317。

没有稳定提速证据，不能用第一组快样本外推；有效timer也不排除系统/驱动/呈现调度影响。远景同样高值意味着不能把高延迟全归因于解析96步。

## 正式默认与回归

仍为解析96步，supportCull默认0；未把实验开成正式视觉路径。

新增test-cosmic-diagnostics执行实际timer方法的GL mock，覆盖unsupported/busy、count上限、timeout90、disjoint拒绝、成功/异常的end/delete与固定grade；原有normal grade递增不变。analytic-budget/cosmic-depth/main-redesign/inline/built全部通过，三入口已重建。

仍未完成：截图写入权限故障、实际构图/质感验收、连续旅程与高延迟根因。当前进展是测量可靠性，不是宣称视觉质量达标。goal保持active。
