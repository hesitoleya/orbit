# P2 生产管线端点捕获实验

运行 `node tools/p2-production-endpoints-20261117.cjs`。脚本仅内存插桩源码，构建到独立目录，不修改产品源码、正式入口或 PROGRESS。最终报告 `.workbuddy/p2-production-endpoints-a3664bc8-d61a-4bfb-b5a0-c7ca95ca2120/report.json`，状态 `observed-incomplete`；Chrome Headless 157、RTX 4060 Laptop、960×640。源代码及三个正式入口所列哈希运行前后一致。

分别在各自的新页面 seek 至 main lg=19.98 / cosmic lg=20.02、冻结旅程及 `ts=0`，关闭 glare；对生产 `renderFrame` 同步执行参考画布、候选捕获、参考重复及另一颗粒相位。候选拦截生产函数的 `setRenderTarget(null)`，将最终输出改到 RGBA8 目标，其他生产场景绘制、bright/blur、合成及 overlay 沿用生产函数，故并非独立实现或完整转场。比较是画布 `readPixels` 与目标读回全部 RGBA 通道；报告的 meanByte 含 alpha，均为显示编码量化字节差，不是 HDR 精度指标。所有候选 FBO 完整，无记录 GL 错误。

| 场景 | 管线 | 不同 RGBA 通道 | 最大差/255 | 平均差/255 | 同相参考重复不同通道 | 相位 42→43 不同通道 |
|---|---|---:|---:|---:|---:|---:|
| main | 直接 | 95252 | 44 | 0.282002 | 0 | 0 |
| main | Bloom 后处理 | 0 | 0 | 0 | 0 | 34810 |
| cosmic | 直接 | 123905 | 88 | 0.154305 | 0 | 1 |
| cosmic | Bloom 后处理 | 0 | 0 | 0 | 0 | 32558 |

后处理两例在本次固定相位量化输出逐字节相等；直接路径明显不等，原因尚未隔离，画布和 render target 的抗锯齿、编码和其他状态均是待检查因素，不能归因或视为端点通过。相位测试不是全时钟冻结，cosmic 直接路径的 1 通道变化也不能归因于颗粒。固定相位调用前后记录的 uGradeT 值不变，不证明整个场景状态冻结。时间、随机数及异步资源仍在运行。

四例均在场景 `renderer.render` 调用时注入同步 JS 异常；检查包装函数及先前 render target 指针恢复，均符合预期。未检查完整 renderer/GPU 状态，也未证明后续画面恢复；不是 context loss 或分配失败。此测试关掉了真实太阳眩光，未覆盖 glare 驱动的后处理、真实 warp 激活、不同 resize、设备与浏览器、截图事务或完整视觉。即便后处理两例相等，也只是同一生产链末端重定向的有界观察，不能证明独立候选链或任意端点等价。

首轮 `.workbuddy/p2-production-endpoints-efa31968-2775-4184-aa9f-ff7a9df86384/report.json` 因 CDP WebSocket 错误失败，返回完整像素数组过大是可能因素但未经确认；关闭浏览器亦因断连失败，任务后被停止。随后移除跨 CDP 返回原始像素，保留页面内比较，复测 `.workbuddy/p2-production-endpoints-8ac48131-0e72-4bfe-8887-826438d687e1/report.json` 完成；再加入候选 FBO 检查得到最终报告。实验不保存原始像素，无法脱离浏览器报告复核逐字节差异。

下一步应定位直接路径差异，记录并匹配画布与目标的 MSAA、颜色空间及 alpha 配置；补充有效眩光和 overlay、捕获原始图像、独立候选实现及非饱和 HDR、异常后画面恢复、真实 context loss/分配失败。物理机位、同步更新和用户视觉验收也仍未解决，**尚未完成跨场景转场**。
