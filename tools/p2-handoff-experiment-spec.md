# P2 自然接力同快照实验设计（未执行）

目的：在不修改产品渲染的条件下，区分接力前后真实坐标基变化、相机输入时序和投影手性；不以正向相机角相近代替对象屏幕对齐。

## 隔离和采样

使用当前 `public/js/app.js` 生成一次性隔离预览，在内存插桩前确认每个标记恰好出现一次，记录源码、模板、构建输入和输出哈希。不要覆盖 `space.html`、`index.html` 或 `space-http.html`。用 BrowserSkill 控制浏览器；保持原始失败记录。自然播放、非 seek，分别在以下位置克隆而不是引用可变向量：

1. 最后一个主场景渲染帧的 `placeCamera()` 之后；
2. `journeyCineStep` 接力中的 `viewDirection(w)` / 世界上方向计算后、写入宇宙角度之前；
3. 本帧 `viewOff`、`upCur` 和最终 theta/phi 写入之后；
4. `cosmicUpdate` 的 `lookAt` / 矩阵逆更新之后、宇宙帧实际 render 前。

每份记录 frameId、时钟、lg、活动场景、Qe、cam.dir/pitch/yaw、w、原始和实际相机正交 forward/up/right，theta/phi、viewOff/upFrom/upCur、target/R/unit、camAbs、SUN.pos、SUN_GAL；两个相机 projectionMatrix、inverse、matrixWorld/inverse、fov/aspect/zoom/near/far/view offset。记录设备、资源就绪与错误。主循环先 `journeyTick`，再进入主场景时间/相机更新或宇宙分支，因此接力处输入可能来自上一主场景帧；不把两个相邻帧当同一时刻。

## 同快照 CPU 对照

从同一入射快照构造：A 当前轴同向；B 按实际 `GA/galWorld` 映射 forward/up；C 在 B 上以 `P_B=P_A S` 右乘 `S=diag(-1,1,1,1)`，即先在相机空间反射 X 再施加完整原投影；不对非对称投影使用 clip-X 左乘。逆矩阵重新求逆，不能仅翻单个矩阵元素。保留原有 FOV、aspect、zoom 和偏移；先检验基矩阵近正交及负行列式。

对中心、左右上下离轴和非对称三角形进行完整投影，标记视锥、齐次 w 与近远裁剪；B 的横向镜像和 C 的 xy 对齐作为候选检验，而不是预先保证的结果。设置并报告容差（CPU 初始 1e-5 NDC）与最大误差、样本量；near/far 不同时只对可比 xy 做判定，单独报告 z。C 的投影有向面积应翻号；这不代表 GPU 剔除已经修正。负控包括不映射、错误轴符号、取消 H、错误矩阵乘法顺序及错误投影参数，确认每个负控确实被检出。

## 物理位置与验收边界

候选位置 `SUN_GAL + M(camAbs - SUN.pos)` 与宇宙层 `target + R*n` 分开记录；两侧有不同单位与距离、天球和有限距离，必须核验太阳锚点及同源天体后才能比较。相邻帧含时间推进，不能直接称为瞬时跳距。对应星体还要处理距离、视差、遮挡、图片与程序层；输入、时钟和资源必须有状态记录。

后续需通过真实 GPU、生产后处理、正反向自然运动、状态恢复、资源失败、图片及连续帧量化验证。CPU 投影反射会改变三角形绕序与 `gl_FrontFacing`，不能直接合入。此文档是实验计划，**没有声称已运行或通过**。
