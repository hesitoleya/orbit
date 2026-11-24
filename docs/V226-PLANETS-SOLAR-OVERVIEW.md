# v226 图鉴八大行星、删除看太阳、恢复太阳系光芒

## 用户要求

删掉看太阳功能；八大行星加入实际图鉴。用户再次确认近景/太阳系均看不见太阳、光芒消失，v225读回证据不能作为用户视觉问题已解决的结论。

## 改动

- public/index.html删除sunAimBtn；app删除aimAtSun、aimSun调试API及?aim=sun自动转向。隐藏旧导航移除独立太阳条目。旧GO.sun兼容路径转太阳系全景，不再太阳近景。
- 真实atlasModal追加UI-only八大行星，行星分类、中文/英文搜索、半径/轨道半长轴/公转周期、直接__SE.go跳转；行星缩略图CSS示意、非实拍，绝不拿星系实拍冒充。268深空源不变，完整载入时UI共276。API失败仍能用8行星，late inline可恢复，不把部分分页当完整库。
- 恢复updateSunGlare，无条件GLARE.vis0/return删除。保留真实太阳投影、屏外/背后/异场景/开关门控，补所有近处行星/月球解析遮挡。删除旅程屏幕固定假光源分支。
- 太阳系全景pitch=-π/2/yaw0正对日心；远距point3→7px，仍真实位置且depthTest；halo旧billboard仍不用，光芒由已有HDR镜头合成恢复。
- 主相机far按实际太阳距离至少2倍动态扩展，避免5e13到1e20主场景的裁剪空档。

## 验证

8187 BrowserSkill pifj，正式/space.html，v226：

- atlasBtn显示276；实际DOM八张行星卡，分类行星8；点击木星卡后modal关闭、cam.focus木星、GL0。
- legacyGO.sun进入alt6.6e12全景而非近景，pointvisible，日心NDC(-.03143,-.01946)，光芒vis1/atm.12，实际日心周围21×21最大RGB246，441像素RGB总和>150。GL0/failedPrograms0。只证明光源及镜头输出，不是审美验收。
- alt1e16主场景far=2.000000139268e16，glarevis1，GL0。
- 最终删helper后重建再刷新：buildv226、sunAimBtn不存在、aimSun API不存在、GL0；atlas8卡、正确示意说明、glarevis1/failed0。
- 截图保存仍被Windows Temp权限拒绝，未修ACL、没有据此声称看过完整视觉画面。

实际IIFE DOM测试test-atlas-planets涵盖8跳转、分类搜索分页、冻结deep268不变、late inline、同步/异步/第二页失败、去重/数量。test-solar-overview执行真实glare函数高空分支及背后/行星遮挡/异相机/off门控。sun-multilod7、sun-sphere-patch12、cosmic-depth、main-redesign、cinematic-inline、check-built-content通过。最终三入口重建；未把深空SQL计数改成276。
