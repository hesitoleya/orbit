# v220 宇宙标签空间与可见性修复

## 确认的问题与修改

- WEB_NODES锚点构建时位置单位为Mpc，标签曾直接当成当前帧相机相对render units投影。现在构建时存储米制userData.pos，标签按 `(pos-camPos)/unit` 投影，和普通目录星系一致。
- CMB距离锚点本来是米制，单独保存pos和cmbNode标志，沿同一相机相对路径投影。
- 银河标签曾固定sz=40、不检查银河是否可见；现在仅在当前mainGalaxy.visible时参与候选。
- webNode不再无条件豁免可见性：普通节点要求cosGroup和web/webPts实际可见，CMB节点要求CMB开启且cmbShell/cmbBall至少一个可见。
- 标签pass移到本帧主银河visible更新之后，避免首次进入/退出时沿用前一帧。

## 执行行为验证

`tools/test-cosmic-depth.cjs`提取并执行实际完整cosmicLabels函数，不是另写近似公式。使用仓库真实Three.js PerspectiveCamera/Vector3投影：

- unit=1e20、1e24、1e26三种比例下，等比例世界位置产生完全一致的标签left；锚点的m.position故意设错误值999以确保读取米制pos。
- web可见时标签进入；web/webPts均关闭后标签退出。
- mainGalaxy不可见时银河标签退出。
- CMB图层不可见时CMB节点退出；cmbShell开启时进入；CMB总开关关闭后退出。
- 既有photoLayer标签、5–12px LOD、7px银河gain、CMB重叠、源几何照片直径测试继续通过。

main-redesign、cinematic-inline、check-built-content、cinematic-streaming均通过；三个正式入口已重建且exact-source/hash检查通过。

## 没有完成的验证

本轮bsk_session.start明确返回 `no browser is currently connected`，没有创建有效浏览器session。因此v220没有新的浏览器/GPU/全旅程帧时结果，不能用v219 GPU读回替代。此前截图临时目录写入拒绝也没有解决。完整视觉目标仍未完成，不标记goal complete；不把离线Three.js投影测试说成GPU渲染或电影级审美验收。

下一次应先恢复BrowserSkill扩展连接，然后检查v220三个尺度实际画面、全旅程帧时与标签位置，保留真实二维照片/艺术体积/程序宇宙网的边界。
