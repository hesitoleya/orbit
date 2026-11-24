# v212 场景恢复与首次ROI GPU数值检查

## 正式更改

- Build `v212-volume-recovery`，SW `space11-v212-volume-recovery`。
- 设置增加「重试当前体积」：只在当前目标加载失败、功能开启且无pending时显示；不会清空其它已就绪cache。失败诊断以textContent显示在折叠详情，截断180字符，不渲染服务端HTML。
- loader每次真正开始重试清除旧error；native gzip reader成功/失败都releaseLock。原半成品发布保护不变。
- status增加supported，WebGL2不可用时禁用开关并明确基础解析降级，而不是显示可开启状态。
- 回归测试扩为streaming7case：真实gzip/Three Data3DTexture fixtures、auxiliary hash失败→更正数据→无刷新重试、旧error消失、pending去重、unsupported拒绝load。UI fixture执行真实update/retry绑定检查按钮、理由、关闭/禁用/pending guard。

## BrowserSkill现场证据（2026-11-21，非截图视觉验收）

1. 本轮后半段浏览器恢复连接，session `qnmg`，会话已关闭。
2. 初次8173返回的是旧v207：本机server未运行，浏览器显示SW缓存。启动任务server，访问新query并点击「有新版本可用 / 刷新」后才检查最新DOM；不能把缓存旧页算新版本证据。
3. 真实正式页进入Orion后DOM：当前目标猎户座M42／开放电离壁形态模板（同类共享）；256×256×256、含方向光照、80.1MiB缓存；当前流畅档128上限；折叠详情可点击。仅DOM核对，不是布局美观或全部质量档位验收。没有故意改线上资源模拟失败，重试实际逻辑用fixture验证。
4. 隔离8174实验真实WebGL2 shader编译/link并draw完成：低档glError0，加载fine后glError0、errors[]、CPU持有65536B／估算GPU134250500B。GL draw后finish/readPixels：1000×700 framebuffer，700000非黑像素、0个精确magenta溢出像素。
5. 同GPU像素比较：先在fine=true/skip=true保留RGBA8 readPixels，再点「保守空区跳跃：关」并再次finish/readPixels。2800000通道中39通道变化，maxByteDelta1，meanByteDelta0.000013928571428571429，无magenta，glError0。这个测试是真实GPU定点画面的数值一致性，不是CPU参考替代。
6. 再点低档：fine=false、CPU32768B／估算GPU67141636B、glError0、errors[]。不等同驱动实际释放或RSS测量。
7. screenshot两次和canvas链接download均因BrowserSkill临时目录权限错误`拒绝访问 (os error 5)`失败；没有可展示/复核截图，因此未声称电影级画质或视觉边界接缝已验收。未走CDP/backend绕过。
8. 实验仍`gpuValidated:false`，该字段代表完整验收而非是否曾运行；本次只把「从未编译运行」推进为「单机单画面编译/数值/低档恢复通过」。逐光tau与总光场实验均未上GPU，主场景high/ultra/M51/多角度/动画/真实GPU帧时仍待验证。

## 构建与关闭

- 离线space/index110490030B SHA256 `df26f35a0fa7994d43411ff093d9cc342a21ef2775e2b033156e705b11cd77b1`。
- HTTP25872102B SHA256 `d8d1957a3711aec1fefc3156ec60da185eea783d7f9acbc3bb7832817849a32c`。
- cinematic-content、streaming、main-redesign、inline27gzip/raw hashes、built-content套件通过；故意损坏fixture输出integrity warning但exit0。
- 任务server8173/8174均停止并collect job，未留新后台服务。需要使用时启动 `node server/server.mjs --port 8173`；实验启动 `node tools/roi-lab/server.cjs`。

目标尚未完成：正式功能内容和恢复路径已有实质改进，ROI单画面GPU数值初验完成，但最终视觉/GPU性能/多光照方案整合证据不足，不能标记整个电影级目标完成。
