# v222 宇宙体积性能诊断：未部署降采样

## 背景与实现

v221短rAF采样有133–167ms的高帧间隔。不能直接假设是96步体积导致。

本轮添加：
- 独立uAnalyticSteps，默认96，诊断范围64–96；仅作用于解析fallback，不改cinematic DDA/体积资产采样。
- 全区间积分ds=(b-a)/N与静态max96循环，禁止break-only截断；均匀介质/纯发光/深度短区间测试通过。
- 解析支持域radius>=1.18时提前返回零的实验uniform。**正式默认关闭（0）**，不以未证明的优化改变质量。
- 有界cosmicFrameProbe(1..6)：主动渲染、finish、真实readPixels；finishInclusiveMs是同步API提交/等待包络，不是GPU timer query。
- cosmicSupportParity([flagA,flagB])：在同一JS调用内比较两张最终framebuffer，恢复uniform；可做off/off控制组。

## 实测与否决

BrowserSkill xmna，8183正式v222，glError均0。

64vs96试验（R2e21）平均RGB2.6106→2.6048，热样本finishInclusiveMs约.4–1.2ms，没有稳定收益。薄盘采样本身有误差风险，不部署64默认。

支持域裁剪初测三尺度R2e21/2e22/3e23：最大通道差5/5/4，平均通道差.04372/.00257/.00196，A/B计时交错且无稳定提升，因此保持关闭。

追加控制组（R2e21，876×461）验证：

|比较|changed channels|max channel delta|mean channel delta|glError|
|---|---:|---:|---:|---:|
|off/off|44354|5|.044481|0|
|off/on|44538|5|.044277|0|
|off/off恢复|44587|5|.045170|0|

两次完全相同的开关也有同等帧间差异，因此最终图像链不是逐帧字节确定；不能将off/on差归因于裁剪。同步probe最后1.3/1.1ms也不能说明rAF高延迟已解决，更不能当完整旅程FPS或GPU执行时间。需要后续隔离后处理/动态图层并用disjoint timer query或可控离屏目标测量。

## 保守结论

默认96步、支持域实验关闭、画幅未主动降低。v222主要交付诊断与行为测试，而非宣称性能优化完成。

test-analytic-budget检查默认96/实验关闭、N*ds完整区间、最后中点、64/80/96均匀传输积分与sigma0纯发光；main-redesign检查所有构造默认；cosmic-depth/inline/built回归与正式三入口重建通过。截图权限故障未解决，视觉审美与高帧间隔原因仍未完成，goal保持active。
