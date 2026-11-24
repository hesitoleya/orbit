package com.orbit.space.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.orbit.space.model.CatalogStats;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 天文星表数据处理模块（本后端相对原 Node 版“多出来”的 Java 核心算法）。
 *
 * <p>读取前端已有的真实天文数据文件，用纯 Java 做统计聚合，向前端/论文提供结构化摘要：
 * <ul>
 *   <li>{@code data/mwgc.json}：144 个真实球状星团（Harris 星表），每条为
 *       [显示名, NGC/Pal编号, 赤经°, 赤纬°, 日心距kpc, 银心距kpc, 积分视星等, X, Y, Z]；</li>
 *   <li>{@code data/esa/galmap.json}：已建库的星系，每条含 type 字段用于分类计数。</li>
 * </ul>
 * 整个解析、极值/均值计算、分组计数全部在 JVM 内完成，可作为毕设“数据处理层”范例。
 */
@Service
public class CatalogService {

    private final ObjectMapper mapper = new ObjectMapper();

    @SuppressWarnings("unchecked")
    public CatalogStats analyze(Path root) throws IOException {
        // ---- 球状星团：mwgc.json 是“数组的数组” ----
        int globularCount = 0;
        double magMin = Double.MAX_VALUE;
        double magMax = -Double.MAX_VALUE;
        double magSum = 0.0;
        double distSum = 0.0;

        Path mwgc = root.resolve("data/mwgc.json");
        if (Files.exists(mwgc)) {
            List<List<Number>> rows = mapper.readValue(
                    mwgc.toFile(), new TypeReference<List<List<Number>>>() {});
            for (List<Number> row : rows) {
                if (row.size() < 7) {
                    continue;
                }
                double mag = row.get(6).doubleValue();   // 索引 6 = 积分视星等
                double dist = row.get(4).doubleValue();  // 索引 4 = 日心距 kpc
                magMin = Math.min(magMin, mag);
                magMax = Math.max(magMax, mag);
                magSum += mag;
                distSum += dist;
                globularCount++;
            }
        }

        double magMean = globularCount > 0 ? magSum / globularCount : 0.0;
        double distMeanKpc = globularCount > 0 ? distSum / globularCount : 0.0;

        // ---- 星系：galmap.json 是“对象的数组”，按 type 分组计数 ----
        int galaxyCount = 0;
        Map<String, Long> galaxyByType = new LinkedHashMap<>();
        Path galmap = root.resolve("data/esa/galmap.json");
        if (Files.exists(galmap)) {
            List<Map<String, Object>> rows = mapper.readValue(
                    galmap.toFile(), new TypeReference<List<Map<String, Object>>>() {});
            galaxyCount = rows.size();
            galaxyByType = rows.stream()
                    .map(r -> String.valueOf(r.getOrDefault("type", "Unknown")))
                    .collect(Collectors.groupingBy(
                            t -> t, LinkedHashMap::new, Collectors.counting()));
        }

        return new CatalogStats(
                globularCount, magMin, magMax, magMean, distMeanKpc, galaxyCount, galaxyByType);
    }
}
