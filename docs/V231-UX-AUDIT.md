# v231 全站体验巡检（进行中）

## 首批复现与修复

- 图鉴article卡片只有onclick，键盘无法定位：新增tabindex=0、定位名称、Enter/Space激活与focus-visible。保留article语义及内部wiki/HD按钮，避免嵌套button。
- 高清图Escape与图鉴Escape独立监听，按一次两层同时关闭：共享OrbitModalKeys，顶层Escape preventDefault+stopImmediatePropagation；Atlas在HD/登录层激活时让位。
- 高清关闭回原按钮，图鉴关闭回原入口；延迟搜索focus先确认图鉴仍打开。Tab/Shift+Tab在当前弹层首尾循环，普通键不冒泡到场景快捷键；搜索补显式aria-label。

## 证据

- actual atlas IIFE VM：277/9目录、Sun/八行星/BH路由保持；Enter激活Sun通过。
- actual modal helper VM：Escape单层、Tab/Shift+Tab首尾循环、从外部拉回焦点、普通键阻止场景冒泡且保留默认行为。
- 正式HTTP浏览器irou：打开图鉴→仙女座高清→真实Escape，HD关闭/atlas.on保留/焦点回data-hd=esa_heic1502a/GL0。搜索海王星→实际Enter卡片，modal关闭/focus=atlasBtn/GL0。
- 390×844模拟初步检查图鉴：document scrollWidth=clientWidth=390，头部高度约182、网格约454，未见文档横向溢出；不代表真触摸滚动已通过。
- node test-modal-keyboard/test-atlas-planets/test-cinematic-inline/check-built-content通过，三正式入口已重建，SW v231-atlas-keyboard-r1。

## 第二批：登录弹层与矮屏（round 30）

- auth.js接入共享键盘策略，同时内置独立catalog页的后备策略：Tab约束、顶层Esc、普通键不穿透到场景；关闭恢复原触发按钮，重复open不覆盖原focus，延迟focus先检查仍打开。
- 注册表单加border-box/max-height(100dvh-24px)/overflow-y:auto/触摸pan-y，长表单可在矮屏内部滚动；没有把根html的touch-action改掉，真触摸滚动仍需另外验证。
- 主场景375×667模拟：Atlas→Auth→注册，box宽345/高620完整在视口内；真实Shift+Tab从close循环到submit，Tab回close；真实Esc仅关Auth、Atlas保留，focus回登录按钮，GL0。
- 独立catalog375×400模拟，确认无OrbitModalKeys、后备策略实际运行；注册框y12/高376/bottom388，内容677/client374；Shift+Tab使submit获焦并自动内滚303px、按钮bottom314可见；Esc关闭并回登录按钮。未填写/读取凭据，未提交表单/创建账户。
- actual auth函数VM覆盖shared/standalone、重复open、关闭后延迟focus保护、首尾Tab、返回focus。与modal/atlas/inline/built回归均通过，正式三入口重建，SW v231-auth-dialog-r2。

## 待继续

1. 手机触摸滚动：html/body touch-action:none与scroll区域可能冲突，需实测/审查祖先链，不凭静态猜测改全局。
2. 登录键盘/矮屏已验证；真设备软键盘与触摸滚动、登录API错误恢复未覆盖。
3. 目录API只加载失败后local9，缺少明确重试；page2失败刻意fail-closed，不擅自把部分档案标完整。
4. 首页/api目录没有PH/HDK，和正式内联页面的高清按钮展示不一致（开发根页面未出现HD按钮，正式有）。
5. 导航/跨场景切换、其他页面异常提示/移动端进一步巡检。

## 第三批：目录部分失败恢复与移动触摸区域（round 31）

- 修正目录API page1成功/page2失败时丢弃第一页的问题：现在保留page1并显示“部分加载失败，可重试”，页脚提供“重试深空档案”；重试成功后自动合并两页并清除错误状态。
- Atlas滚动区域加入overscroll-behavior:contain、touch-action:pan-y；主页面仍保持canvas的html/body touch-action:none，避免场景拖动被目录手势夺走。375×667模拟实际DOM computed：grid scrollHeight 9395/clientHeight 278，touchAction pan-y，overscroll contain，body none，证明可滚动区域已隔离（非真机触摸证明）。
- VM回归增加page1保留、partial卡片可见、retry点击、retry成功合并与错误清除，且原有277/9/BH/键盘路由仍通过。三正式入口已重建，SW v231-catalog-retry-r3。
- 另外发现并修复主场景面包屑导航被祖先 #ui 的 pointer-events:none 吞掉：#crumb 显式恢复 pointer-events:auto。正式HTTP页重载后实际点击“本星系群”进入cosmos active/GL0；从cosmos点击“太阳系”现在绕过主场景warp竞态，500ms后active=false、body清空、warp.active=false、GL0；点击“宇宙”再回cosmos active=true、GL0。此前按钮虽可见但鼠标点击会被stage覆盖，且宇宙→太阳系会卡在warping。已将CSS/返回路径契约加入回归检查。
- 暂未覆盖服务端持续不可用时的多次退避、真机触摸/软键盘，以及完整跨场景导航链。

限制：浏览器自动截图Temp权限失败仍未处理，未宣称整体视觉全站无缺陷；未提交登录表单、创建账户或改用户数据。
