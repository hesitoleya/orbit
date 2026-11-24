package com.orbit.space.filter;

import com.orbit.space.service.Metrics;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * 静态资源 HTTP 缓存过滤器（1:1 复刻原 Node 版 server.mjs 的 ETag + 304 行为）。
 *
 * <p>对静态 GET 请求：
 * <ol>
 *   <li>把请求路径映射到前端 {@code public/} 下的物理文件（{@code /} → index.html）；</li>
 *   <li>用 {@code W/"<sizeHex>-<mtimeHex>"} 生成与 Node 版完全一致的 ETag；</li>
 *   <li>若客户端 {@code If-None-Match} 命中，则直接返回 304，不重传文件体；</li>
 *   <li>否则写入 ETag / Cache-Control，放行给 Spring 静态资源处理器流式返回。</li>
 * </ol>
 * 该过滤器只作用于静态资源（跳过 {@code /api/**} 与 {@code /favicon.ico}），
 * 既保证“改完代码立刻看到新版本、未改动则秒回 304”，也顺带统计静态流量给 /api/health。
 */
@Component
public class EtagFilter extends OncePerRequestFilter {

    @Value("${orbit.public.dir:../public}")
    private String publicDir;

    private final Metrics metrics;
    private Path root;

    public EtagFilter(Metrics metrics) {
        this.metrics = metrics;
    }

    @PostConstruct
    void init() {
        this.root = Paths.get(publicDir).toAbsolutePath().normalize();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String uri = request.getRequestURI();
        if (!"GET".equals(request.getMethod())
                || uri.startsWith("/api/")
                || uri.equals("/favicon.ico")) {
            chain.doFilter(request, response);
            return;
        }

        Path file = resolve(uri);
        if (file == null || !Files.exists(file) || Files.isDirectory(file)) {
            chain.doFilter(request, response);
            return;
        }

        long size = Files.size(file);
        long mtime = Files.getLastModifiedTime(file).toMillis();
        String etag = "W/\"" + Long.toHexString(size) + "-" + Long.toHexString(mtime) + "\"";

        response.setHeader("ETag", etag);
        response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");

        String inm = request.getHeader("If-None-Match");
        if (etag.equals(inm)) {
            response.setStatus(HttpServletResponse.SC_NOT_MODIFIED);
            metrics.incStatic(0);
            return;
        }

        metrics.incStatic(size);
        chain.doFilter(request, response);
    }

    /** 把请求 URI 解析为 public/ 下的物理文件，包含目录首页与目录穿越防护。 */
    private Path resolve(String uri) {
        String p = uri;
        if (p.endsWith("/")) {
            p += "index.html";
        }
        Path f = root.resolve("." + p).normalize();
        if (!f.startsWith(root)) {
            return null; // 目录穿越攻击防护
        }
        return f;
    }
}
