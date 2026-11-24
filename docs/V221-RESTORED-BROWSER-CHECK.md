# v221 恢复浏览器连接后的实机复核

## 恢复与缺陷

用户恢复扩展后，BrowserSkill成功打开8182正式v220（session tnuq），62照片层/62贴图正常。截图仍返回临时PNG访问拒绝，与扩展连接是不同问题。

实机抓到visible不等于可见内容：COSMO_CAT的material.opacity归零后m.visible仍true，标签仍进入；程序网cgK归零后web.visible仍true，R=2e26残留“时钟座-网罟座超星系团”标签。

v221增加结构opacity>.005可见门槛、标签材质opacity判断，以及程序网cgK>.005门槛（包括inside branch，防止覆盖）。实际完整标签函数/源提取单测增加透明材质拒绝用例，其他LOD/投影/资源回归通过。

## v221 GPU实测

同一浏览器重新导航v221，canvas988×531，WebGL2 finish/readPixels：

| R | 非黑像素 | 照片可见 | 程序网可见 | 标签数 | glError |
|---|---:|---:|---|---:|---:|
| 2e22 | 2682 | 2 | false | 5 | 0 |
| 3e23 | 1947 | 2 | false | 16 | 0 |
| 2e25 | 55638 | 0 | true | 4 | 0 |
| 2e26 | 524628 | 0 | false | 0 | 0 |
| 4e26 | 524628 | 0 | false | 0 | 0 |

v220在R=2e26为web=true但line/point gain=0并残留一个结构标签；v221为web=false和空标签。证明修复进入真实浏览器。

## 帧间隔与验收限制

v220同机16帧粗采样各尺度rAF median/P95（毫秒）：2e21 166.6/333.2，2e22 133.3/200，3e23 5.6/44.5，2e25 166.6/200，2e26 11.1/100.1，4e26 66.7/100。样本短且浏览器后台/负载/动态分辨率会影响rAF，不是GPU timer query，也不是完整旅程性能报告；只能得出不能宣称流畅，不能把偶然快的一档外推。

截图权限问题仍在。实际构图/电影级观感和完整旅程帧时未验收，goal不应标记complete。保留二维照片与艺术体积/程序网边界。

正式三入口已重建，cosmic-depth、main-redesign、cinematic-inline、check-built-content通过。
