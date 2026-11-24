# v227 分层太阳镜头光芒

用户要求太阳光芒重做优化。不恢复已删除的看太阳入口，不改变8行星图鉴。

## 设计

原合成aure exp(-r4.6)/veil exp(-r1.35)覆盖很宽，星芒多组叠加且全画面乘gain压暗。现替换为SOLAR_OPTICS_V2：

- 按drawing buffer像素宽度的紧核、局部shoulder、短半径skirt；大气晕仅按atmosphere权重启用。
- 独立细长aperture rays及微弱anamorphic streak；奇数光阑产生2N芒，偶数N芒。中心atan0显式guard。
- 2枚极弱离轴ghost；中心附近offAxis0，无目标环；使用正向Gaussian代替旧逆序smoothstep。
- 没有全帧c*=gain；太阳局部additive HDR，gain clamp4、star clamp3。
- solarOpticsParams以真实太阳距离/球面投影估算中心角径，极近限幅2；resolved日面用discMask保留细节，仅轮廓外注入halo。能量远距温和衰减，仍是示意镜头PSF，不是标定能量守恒或日冕几何。
- 非地球焦点直接真空投影，不套地固系太阳高度/LUT/地形。仍保留真实位置、背后/异场景关闭、实体行星/月球遮挡。

## 证据

8188 BrowserSkill zbdh。正式/space.html v227 GPU编译通过，GL0，failed programs0。太阳系vis1；背向pitch+π/2后vis0/GL0。

同后期管线glare on，k0对k1，固定gradePhase0、同步snap/readPixels：876×461画幅，按太阳投影半径<.02/<.12/其余区域，平均RGB增量101.357/16.613/.22867，最大增量226，负增量通道0。说明新增光照集中、无此采样中的全帧压暗，不是与v226等画幅完整A/B审美验收。

早期直接读帧全0是WebGL drawing buffer生命周期，不是shader黑；改同步snap再读取有效。早期glare off/on比较混入direct-vs-post路线差异，不采用为optics-only证据。

最终再构建/刷新v227：390×844和1280×800 shot重新绘制/图片解码成功，MSAA4，GL0/failed0，screenshotDiagnostics无恢复错误。不同宽高比导出恢复后GLARE.uv会回原画幅，不能将事后原uv单像素比较当不同画幅亮核一致性证据。

测试：test-solar-optics实际参数函数，450/800/1080/2160像素步长、距离范围、径向单调/界限、单独ray envelope、4/5/6/8/12实际CPU角峰数量、resolved日心mask；test-solar-overview执行实际门控且新增非地球低alt；atlas、sun-patch12、main/inline/built均通过。三入口重建。

局限：未取得完整画面截图做审美判断；截图工具之前持续Temp拒绝，本次没有修ACL。数值读回/编译及导出证明渲染执行，不等于用户视觉最终满意。没有测到稳定性能收益，不宣称提升FPS。
