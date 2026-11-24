package com.orbit.space.model;

/**
 * /api/stats 返回清单中的单条文件记录。
 *
 * @param file  相对前端根目录的路径（使用正斜杠）
 * @param bytes 文件字节大小
 */
public record FileEntry(String file, long bytes) {
}
