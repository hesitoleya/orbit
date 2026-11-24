package com.orbit.space.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.orbit.space.model.CatalogStats;
import com.orbit.space.model.HealthInfo;
import com.orbit.space.model.StatsResult;
import com.orbit.space.service.CatalogService;
import com.orbit.space.service.Metrics;
import com.orbit.space.service.StatsService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * REST 接口层。1:1 复刻原 Node 版 server.mjs 的三个接口，并新增 /api/cosmos。
 *
 * <ul>
 *   <li>GET /api/health — 服务存活与运行指标；</li>
 *   <li>GET /api/peaks  — 真实高峰群数据（地形高程数据源），读 data/peaks.json；</li>
 *   <li>GET /api/stats  — 前端资源清单（遍历 public/）；</li>
 *   <li>GET /api/cosmos — Java 数据处理模块：解析真实天文星表并做统计聚合。</li>
 * </ul>
 */
@RestController
@RequestMapping("/api")
public class ApiController {

    private final Metrics metrics;
    private final StatsService statsService;
    private final CatalogService catalogService;
    private final ObjectMapper objectMapper;

    private Path publicRoot;
    private final String appName;
    private final String appVersion;
    private final long startedAt = System.currentTimeMillis();

    public ApiController(Metrics metrics,
                         StatsService statsService,
                         CatalogService catalogService,
                         ObjectMapper objectMapper,
                         @Value("${orbit.public.dir:../public}") String publicDir,
                         @Value("${orbit.app.name:space-1to1}") String appName,
                         @Value("${orbit.app.version:34}") String appVersion) {
        this.metrics = metrics;
        this.statsService = statsService;
        this.catalogService = catalogService;
        this.objectMapper = objectMapper;
        this.appName = appName;
        this.appVersion = appVersion;
        this.publicRoot = Paths.get(publicDir).toAbsolutePath().normalize();
    }

    @GetMapping("/health")
    public ResponseEntity<HealthInfo> health() {
        metrics.incApi();
        HealthInfo info = new HealthInfo(
                true,
                appName,
                appVersion,
                (System.currentTimeMillis() - startedAt) / 1000,
                System.getProperty("java.version"),
                metrics.apiHits(),
                metrics.staticHits(),
                metrics.bytesOut()
        );
        return ResponseEntity.ok(info);
    }

    @GetMapping("/peaks")
    public ResponseEntity<Object> peaks() throws Exception {
        metrics.incApi();
        Path file = publicRoot.resolve("data/peaks.json");
        Object body;
        if (java.nio.file.Files.exists(file)) {
            body = objectMapper.readValue(file.toFile(), Object.class);
        } else {
            Map<String, Object> fallback = new LinkedHashMap<>();
            fallback.put("peaks", List.of());
            body = fallback;
        }
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(1, TimeUnit.HOURS))
                .body(body);
    }

    @GetMapping("/stats")
    public ResponseEntity<StatsResult> stats() throws Exception {
        metrics.incApi();
        return ResponseEntity.ok(statsService.scan(publicRoot));
    }

    @GetMapping("/cosmos")
    public ResponseEntity<CatalogStats> cosmos() throws Exception {
        metrics.incApi();
        return ResponseEntity.ok(catalogService.analyze(publicRoot));
    }
}
