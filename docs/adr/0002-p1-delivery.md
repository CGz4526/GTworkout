# 0002 账号与版本化备份落地

2026-10-16。用户明确授权：不影响现有数据即可直接执行，无需逐次审批。因此仅创建 workout 专用数据库与命名卷，测试使用 Testcontainers 全新库，不触碰已有 PostgreSQL/MySQL、浏览器 IndexedDB 或原备份恢复路径。

使用 Boot 4.0.8 管理的 Spring Session JDBC 4.0.5、Flyway 11.14.1、JDBC Driver 42.7.13；MyBatis Starter 4.0.0。PostgreSQL 17.6 Alpine 官方镜像已获取并固定 digest。前端 Node、Nginx、后端 Maven/JRE 基础镜像也固定已验证摘要。

会话采用框架标准认证过滤器，登录更新会话 ID，SecurityContext 存 JDBC。注册不自动登录；CSRF 使用会话中的框架掩码 token，登录/退出后重新获取。BCrypt 使用 cost 10，本机 JDK 17 预热 2 次、测量 5 次得到 46/47/48/49/50 ms，中位 48 ms；这是本机散列成本记录，不是完整登录压测或生产性能保证。

原始备份同步校验后存 BYTEA，P1 返回 201/200，投影状态 NOT_REQUESTED；不建立无消费者任务。P2 再通过新增迁移扩展投影状态和任务。不可变原文件下载在真实 PostgreSQL 测试中按字节验证，未知合法字段保留。

并发额度由用户行锁内的 COUNT/SUM 检查，用户+幂等键唯一约束兜底；同键重放在额度检查前处理。上传许可在授权后、DispatcherServlet 解析 multipart 前获取，全局 2、每用户 1；文件实际读取、JSON token、嵌套和字符串各有预算。SQLite/H2 不参与 SQL 验证。

上传附带 X-Expected-User，与服务器认证上下文作一致性比较。它不是资源所有权来源；用于阻止其他标签页切换会话后把旧确认上传到新账号。

单实例内存限流保护登录、注册，数据结构最多 4096 个有效窗口，不信任转发地址。Nginx 下 IP 维度是入口共享限制；不声称分布式限流或真实客户端 IP 识别。公共注册默认关闭，本机启动参数显式开放。

Maven 将纯规则测试放在 test，将真实容器测试放在 Failsafe integration-test/verify。Docker 构建运行 package 的单元测试，不把 Docker socket 挂入构建器；宿主机完整 verify 验证数据库行为。这不是跳过同一测试取得假成功，两个命令的保证范围在运行说明中区分。

首次启动密码仅保留在进程和 Docker 服务配置，不写 .env。再次启动可读取本项目 db 容器配置；发现独立旧卷但缺原容器时停止，要求原凭据，不自动重设密码或清卷。日常操作使用 stop，不用 down/remove 清理数据。
