# v229 图鉴太阳：发光白球

用户要求天体加太阳、太阳呈发光白球。新增实际atlasModal local:star:sun，恒星1分类，白色发光CSS球体缩略图，示意非实拍；radius696340km/temp5772K/G2V，不伪填行星轨道周期。8行星不变，deep268不改，完整UI277/API失败local9。支持太阳/Sun搜索和去重，删除的sunAimBtn不恢复。

GO.sun由system兼容路由改回goTarget(SUN,2.4e9,-π/2)，yaw0，约.44画幅高度的真实球体；沿用v228近白自发光，无星芒横丝ghost。跨场景进入和残留shift清理沿既有goTarget路径。

8191 BrowserSkill mkii，最终/space.html v229：badge277、恒星1/行星8，实际Sun卡DOM有正确资料且旧按钮无。真实点击太阳卡，atlas关闭、focus太阳、alt2.4e9、中心RGBA255/255/255/255，GL0/failed0。源入口另验日心NDC近0/shift0、球直径204.4px（当时buffer≈450px）、中心/40/90px白、140/200px外黑；cosmic2e21→Sun后cosmicfalse/shift0/中心白/GL0。像素结果不是完整截图审美判断。

atlas实际IIFE九跳转/star1planet8/计数277或9/API failure/late inline/deep冻结/去重；sun-multilod执行GO.sun片段验证目标参数/yaw0/角径预算；solar-optics/overview/sun-patch12/main/inline/built通过，三个正式入口重建。
