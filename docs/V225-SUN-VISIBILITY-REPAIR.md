# v225 太阳显示回归修复

用户报告太阳不见。两项已修复：

1. 远距sunPoint的vertex shader包含logdepthbuf_vertex但缺common；仓库r160实际chunk调用isPerspectiveMatrix，定义在common。补公共chunk，同步tools/sun-sphere-patch生成源，防止复发。
2. 显式_gotoBodyInstant未清cam.shift；中断太阳居中回程/flight时可能带AU量级偏移，SUN focus/alt正确但天体离屏。现在显式跳转清shift；同天体跳转存在偏移时也先reset而非保留偏移补间。

## 实机复现与修后

8186 BrowserSkill fevy。

修前构造cam.shift=(1e11,0,0)，GO.sun后shift仍1e11、SUN alt1.3e9、日心NDC(2.3364,1.0783)，屏幕外。修后正式HTTP /space.html加载v225，同fixture shift归零、日心NDC(-.0312,-.01935)、球visible；中心RGB(226,205,165)，GL0/failed programs0。

太阳系全景alt6.6e12，sunMesh退远距point，pointVisible=true，实际日心投影NDC≈(0,-.63829)，围绕投影9×9读回最大RGB255，GL0/failed programs0。

宇宙层2e21→GO.sun后cosmic=false，shift0，太阳visible、NDC≈(0,-.00017)，GL0。

返回Earth后focusEarth、shift0、Earth analytic sphere visible、GL0；中心像素黑，不据此声称地球画面审美通过。

## 测试与交付

test-sun-multilod新增实际Point构造+真实ShaderChunk common依赖、执行实际_gotoBodyInstant残留shift归零；7用例通过。test-sun-sphere-patch12用例、main-redesign、inline、built通过，三个正式入口重建。

最初先运行formal exact-source测试失败是尚未重建的旧solarPoint内联；检查测试读取space.html后先build再跑，全部通过，不是跳过失败。

保留风险：主相机far5e13而主导航可到1e20，超远主场景可能存在太阳被far clip的另一路径；本次没有扩大所有场景远平面或添加假太阳，未声称该超远范围已修复。CS太阳定位点在银河尺度以外有意退出，与实体日面不同。
