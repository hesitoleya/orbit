package com.orbit.space.model;

/**
 * /api/health 的响应体。使用 Java 21 record，字段即访问器，Jackson 可直接序列化。
 *
 * @param ok         服务是否存活
 * @param name       应用名（与 package.json 对齐）
 * @param version    应用版本号
 * @param uptimeSec  启动至今的秒数
 * @param javaVersion 运行时的 Java 版本
 * @param apiHits    累计 API 请求数
 * @param staticHits 累计静态资源请求数
 * @param bytesOut   累计向客户端写出的字节数（近似）
 */
public record HealthInfo(
        boolean ok,
        String name,
        String version,
        long uptimeSec,
        String javaVersion,
        long apiHits,
        long staticHits,
        long bytesOut
) {
}
