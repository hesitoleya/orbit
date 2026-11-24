package com.orbit.space;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * SPACE·1:1 Java 后端启动类。
 *
 * <p>仅负责启动 Spring Boot 内嵌 Tomcat 容器。所有业务都在 controller / service 包中：
 * <ul>
 *   <li>静态资源由 {@code application.properties} 的 {@code spring.web.resources.static-locations}
 *       指向前端 {@code public/} 目录，浏览器直接访问即获得完整的 3D 行星引擎前端；</li>
 *   <li>{@code /api/**} 一组 REST 接口提供数据服务（见 {@code controller.ApiController}）。</li>
 * </ul>
 */
@SpringBootApplication
public class SpaceApplication {

    public static void main(String[] args) {
        SpringApplication.run(SpaceApplication.class, args);
    }
}
