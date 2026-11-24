@echo off
REM 启动 SPACE·1:1 的 Java(Spring Boot) 后端
REM 用法：双击或在 server-java/ 目录下执行 run.bat
cd /d %~dp0
mvn spring-boot:run
