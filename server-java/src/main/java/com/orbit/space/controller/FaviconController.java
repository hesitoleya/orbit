package com.orbit.space.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * 浏览器默认请求 /favicon.ico，原 Node 版把它重定向到 icon-192.png。
 * 这里直接以图片流返回该图标，避免前端控制台出现 404。
 */
@RestController
public class FaviconController {

    private Path icon;

    public FaviconController(@Value("${orbit.public.dir:../public}") String publicDir) {
        this.icon = Paths.get(publicDir).toAbsolutePath().normalize().resolve("icon-192.png");
    }

    @GetMapping("/favicon.ico")
    public ResponseEntity<InputStreamResource> favicon() throws Exception {
        if (!Files.exists(icon)) {
            return ResponseEntity.notFound().build();
        }
        InputStreamResource res = new InputStreamResource(Files.newInputStream(icon));
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_PNG)
                .body(res);
    }
}
