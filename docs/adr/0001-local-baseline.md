# 0001 本机工程基线

日期：2026-10-16。状态：P0 已授权实施。

本机实际为 Oracle JDK 17、Maven 3.6.1、Node 24.12.0、npm 11.6.2。Docker CLI/Engine 29.4.3，Docker Desktop 4.73.1：初始引擎未连接，后续已可用，但镜像获取遇到网络超时。当前目录是源码副本，没有 Git 元数据，无法比较搬迁前的未提交修改。不要据此自动覆盖任何已有文件。

采用 Java 17 和 Spring Boot 4.0.8，Wrapper 使用 Maven 3.9.9。Java 17 满足 Boot 4.0 要求，避免安装全局 JDK。Boot 3.5 已结束开源支持，原方案中 3.5/AI 1.1 的固定组合不再作为实施基线。P3 重新确认稳定的 Spring AI 版本；P0 不引入模型客户端。P1 使用支持 Boot 4.0 的 MyBatis 4.0.x，具体补丁进入该阶段时锁定。

来源：
- https://docs.spring.io/spring-boot/4.0/system-requirements.html
- https://spring.io/blog/2026/06/25/spring-boot-3-5-16-available-now/
- https://github.com/mybatis/spring-boot-starter

前端继续使用现有 package-lock.json，npm ci 安装，保留现有版本。Docker 的版本标签固定，但镜像摘要尚未锁定，镜像拉取和启动验收完成后再记录摘要；当前不能称为完全可重复的容器交付。

P0 只运行前端和无数据库的 Java 底座。服务状态返回明确的 capability=false。存活、就绪检查暂不依赖数据库，P1 引入数据库时必须同步改变就绪语义。所有其余路径要求认证，写操作保留 CSRF；不创建默认账号或打印生成的密码。每个响应生成服务端 traceId，鉴权错误采用 Problem Details。

本地 HTTP 入口只绑定 127.0.0.1:8088；Nginx 独立启动，通过 Docker DNS 延迟解析 Java 地址。后端不可用时静态前端仍可提供。API 与 Actuator 排除于 PWA 导航回退，API 不配置离线缓存。

尚未引入 PostgreSQL、Flyway、Spring Session、业务表或迁移文件。数据库设计只供审阅，须单独批准后实施。

上述是 P0 时点状态。P1 已获用户授权并完成专用库落地，现状见 0002-p1-delivery.md。
