package com.orbit.space.model;

import java.util.List;

/**
 * /api/stats 的响应体：对前端 public/ 目录做全量遍历后得到的资源清单。
 *
 * @param total 所有文件字节数之和
 * @param files 按体积从大到小排序的文件清单
 */
public record StatsResult(long total, List<FileEntry> files) {
}
