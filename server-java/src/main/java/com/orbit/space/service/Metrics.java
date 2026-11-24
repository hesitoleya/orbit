package com.orbit.space.service;

import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicLong;

/**
 * 轻量级运行指标收集器（单例 Bean）。
 *
 * <p>用于 {@code /api/health} 展示实时负载。API 计数在 {@code ApiController} 中累加，
 * 静态资源计数与流量在 {@code EtagFilter} 中累加。仅用原子变量保证并发安全，
 * 不引入额外存储，符合“后端只做薄服务层”的定位。
 */
@Component
public class Metrics {

    private final AtomicLong apiHits = new AtomicLong(0);
    private final AtomicLong staticHits = new AtomicLong(0);
    private final AtomicLong bytesOut = new AtomicLong(0);

    public void incApi() {
        apiHits.incrementAndGet();
    }

    public void incStatic(long bytes) {
        staticHits.incrementAndGet();
        if (bytes > 0) {
            bytesOut.addAndGet(bytes);
        }
    }

    public long apiHits() {
        return apiHits.get();
    }

    public long staticHits() {
        return staticHits.get();
    }

    public long bytesOut() {
        return bytesOut.get();
    }
}
