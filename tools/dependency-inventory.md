# ORBIT 恢复与运行依赖盘点

盘点日期：2026-11-17。此清单是静态文件检查，不是完整软件物料清单、许可证审计、安全审计或兼容性保证。固定版本仅表示项目声明或本地文件标记，不表示来源真实性已验证。

| 范围 | 依赖 / 输入 | 当前证据与边界 |
|---|---|---|
| 直接打开离线入口 | 具备所需 WebGL 能力的浏览器；[space.html](../space.html) 内联构建数据和脚本 | 当前没有本轮实际浏览器运行证据；WebGL 硬件支持、浏览器版本和离线行为仍需实测。独立页面/数据等附加能力不一定都包含在主入口内。 |
| Node 静态服务 | Node.js；[server.mjs](../server/server.mjs) 使用 Node 内置模块 | [package.json](../package.json) 未声明 npm 包依赖；无 Node 引擎最低版本声明。本轮仅验证 Node v24.12.0 能运行若干源码测试，未证明所有版本兼容。 |
| 前端三维库 | 本地 [three.min.js](../public/js/three.min.js) 与 [three.module.min.js](../public/js/three.module.min.js) | module 版源码标记 revision `160`，本轮 Node 动态导入读取 `REVISION` 亦为 `160`；构建读取 UMD 文件。两份版本一致性、来源和许可应单独核实，不能仅凭文件名确认。 |
| 主构建 | Node.js、[build.mjs](../build.mjs)、[模板](../public/index.html)、JS 与 `public/data` 资源 | 构建将输出写到项目根目录；部分可选数据读取失败仅警告，成功退出不等于所有数据齐全。本轮内存重建与三个现有产物逐字节一致，不等同于所有功能通过。 |
| 图鉴构建输入 | 工作区外 `../orbit-server/src/main/resources/db/data.sql` | 当前可读，SHA-256 `06c8695b7be9bdd67f3c1ad90b748f5b3f945812081f714f7e2a366bbe41ec78`。当前构建在读取失败、零对象、部分结构/数值错误或重复标识时会在写入成品前中止；不能保证非空 SQL 的行数完整或天文数据正确。请将兄弟工程作为备份与迁移清单的一部分，不要删除。 |
| 二维瓦片生成 | Python、Pillow；[make-deep-tiles.py](make-deep-tiles.py) | 代码导入 PIL；版本范围与可复现锁定尚未确认。不同版本的图像编码可能影响哈希，需记录实际版本并回归。 |
| 地球资源生成 | Python、Pillow、NumPy；[make-earth-map.py](make-earth-map.py) | [package.json](../package.json) 的 `bake` 还会调用 Node 嵌入脚本及构建，可能改写资源和入口；不能当作只读验证。 |
| 其他资源脚本 | Python 标准库、按工具分别使用 Pillow / NumPy；部分脚本访问外网或调用外部程序 | 须逐工具检查，未声称穷举或已验证下载许可；勿批量执行获取或覆写脚本。 |
| 浏览器测试 | 浏览器和具体测试脚本所要求的运行环境 | 例如 [test-deep-detail.cjs](test-deep-detail.cjs) 声明 Node 22+ 并自行启动 Chrome；本会话的浏览器操作必须使用 BrowserSkill，当前其 `bsk` 命令不可用。历史测试的成功不等于本轮已重测。 |
| 独立 Java 后端 | Java 21、Maven 3.9+；Spring Boot parent 3.3.4 / web starter | 来自 [README](../server-java/README.md) 与 [pom.xml](../server-java/pom.xml)；本轮未编译或运行。Node 和 Java 服务不是同一个实现，不能将一方结果套用于另一方。 |

## 未闭合项

1. 为资源生成工具建立可验证的依赖版本/锁定策略，并记录安装来源及离线可用性；不要把一次本机版本误认为项目支持范围。
2. 逐项核对 Three.js 和图像/数据来源、处理、许可及再分发权；本清单不授予许可。
3. 已为档案 SQL 读取失败及空结果增加构建中止；其他关键输入和非空但不完整的档案仍需逐项核验，并在独立输出和浏览器中验证。
4. 项目不在 Git 仓库；先界定源码、体量巨大的资源、历史 profile、生成物和秘密，再制定可恢复的版本控制与备份方案；不要盲目纳入或清理。
