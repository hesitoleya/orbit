package com.orbit.space.service;

import com.orbit.space.model.FileEntry;
import com.orbit.space.model.StatsResult;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 静态资源清单服务。
 *
 * <p>对应原 Node 版 {@code /api/stats}：用 NIO 的 {@link Files#walk} 递归遍历前端
 * {@code public/} 目录，汇总每个文件的相对路径与字节数，按体积降序排序后返回。
 * 该接口用于运维检查“打包后到底塞了哪些资源、各占多大”。
 */
@Service
public class StatsService {

    public StatsResult scan(Path root) throws IOException {
        List<FileEntry> files = new ArrayList<>();
        try (var walk = Files.walk(root)) {
            walk.filter(Files::isRegularFile).forEach(p -> {
                try {
                    long bytes = Files.size(p);
                    String rel = root.relativize(p).toString().replace('\\', '/');
                    files.add(new FileEntry(rel, bytes));
                } catch (IOException ignored) {
                    // 单个文件读取失败不阻断整体清单
                }
            });
        }
        files.sort(Comparator.comparingLong(FileEntry::bytes).reversed());
        long total = files.stream().mapToLong(FileEntry::bytes).sum();
        return new StatsResult(total, files);
    }
}
