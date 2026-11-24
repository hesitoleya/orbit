package com.orbit.space.model;

import java.util.Map;

/**
 * /api/cosmos 的响应体：Java 数据处理模块对天文星表做统计聚合后的结果。
 * 这是本后端相对原 Node 版“多出来”的核心算法模块，适合写进毕设论文。
 *
 * @param globularCount 球状星团数量（来自 mwgc.json）
 * @param magMin        最亮（视星等最小）的星团视星等
 * @param magMax        最暗（视星等最大）的星团视星等
 * @param magMean       星团视星等均值
 * @param distMeanKpc   星团日心距离均值（千秒差距）
 * @param galaxyCount   已建库的星系数量（来自 galmap.json）
 * @param galaxyByType  星系按类型分类的计数
 */
public record CatalogStats(
        int globularCount,
        double magMin,
        double magMax,
        double magMean,
        double distMeanKpc,
        int galaxyCount,
        Map<String, Long> galaxyByType
) {
}
