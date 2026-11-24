# SPACE·1:1 — Java 后端（Spring Boot）

把原项目里的 **Node.js 服务（`server/server.mjs`）替换成 Java（Spring Boot）后端**，
前端 `public/`（Three.js 行星引擎）一行不改。这是把整个 SPACE·1:1 项目作为 **Java 毕业设计**
时所需的“Java 那一层”。

```
orbit/
├── public/                 # 前端（Three.js / WebGL），本后端只负责托管它
├── server/                 # 原 Node 后端（保留，作为对照）
└── server-java/            # ★ 本工程：Java(Spring Boot) 后端
    ├── pom.xml
    ├── src/main/java/com/orbit/space/
    │   ├── SpaceApplication.java        # 启动类
    │   ├── filter/EtagFilter.java       # 静态资源 ETag + 304（复刻 Node 行为）
    │   ├── controller/ApiController.java# /api/health|peaks|stats|cosmos
    │   ├── controller/FaviconController.java
    │   ├── service/StatsService.java    # 目录遍历清单
    │   ├── service/CatalogService.java  # ★ 星表解析 + 统计聚合（Java 数据处理模块）
    │   ├── service/Metrics.java         # 运行指标
    │   └── model/                       # 响应 DTO（record）
    └── src/main/resources/application.properties
```

## 环境要求
- JDK 21（已验证 `21.0.4`）
- Maven 3.9+（已验证 `3.9.10`）
- 前端 `public/` 目录存在（与 `server-java/` 同级）

## 编译与运行

```bash
# 在本目录（server-java/）执行
mvn clean package -DskipTests        # 打成可执行 jar：target/space-1to1-backend-1.0.0.jar
mvn spring-boot:run                  # 或直接在 IDE 运行 SpaceApplication
```

启动后访问：

| 地址 | 说明 |
|---|---|
| http://127.0.0.1:8132/      | 完整 3D 行星引擎前端（静态托管 public/） |
| http://127.0.0.1:8132/api/health | 服务存活 + 运行指标（JSON） |
| http://127.0.0.1:8132/api/peaks  | 真实高峰群数据（地形高程数据源） |
| http://127.0.0.1:8132/api/stats  | 前端资源清单（遍历 public/） |
| http://127.0.0.1:8132/api/cosmos | Java 星表统计聚合（密度/星等/分类计数） |

> 若前端路径不在默认的 `../public`，用环境变量覆盖：
> `ORBIT_PUBLIC_DIR=D:/WB/orbit/public mvn spring-boot:run`

## 与原 Node 版的对照

| 能力 | Node (server.mjs) | Java (本工程) |
|---|---|---|
| 静态托管 + MIME | ✅ | ✅ (`spring.web.resources`) |
| ETag + 304 | ✅ `W/"<size>-<mtime>"` | ✅ `EtagFilter` 复刻 |
| gzip 压缩 | ✅ | ✅ (`server.compression`) |
| `/api/health` | ✅ | ✅ |
| `/api/peaks` | ✅ | ✅ |
| `/api/stats` | ✅ | ✅ |
| `/api/cosmos`（星表聚合） | ❌ | ✅ 新增 Java 数据处理模块 |
| 语言栈 | Node.js | **Java 21 + Spring Boot** |

## 与原 Node 版并存
`server/` 与 `server-java/` 互不依赖，想用 Node 跑就 `npm run dev`，想用 Java 跑就 `mvn spring-boot:run`
（注意端口都是 8132，二选一启动，避免冲突）。
