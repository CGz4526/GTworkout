# P1 准备阶段验证

状态：已完成迁移审批稿、接口契约与独立输入规则；尚未开始数据库落地或开放接口。

变更：CredentialsPolicy 实现用户名规范化、密码 Unicode 完整性和 BCrypt 72 字节输入边界；UploadIdentity 实现标准 UUID、IANA 区域时区和版本化请求指纹。规则不会读取数据库、保存密码或改变当前服务 capabilities。

Maven Wrapper verify：12 tests，0 failure、0 error、0 skipped，BUILD SUCCESS。包括原 5 项 HTTP 边界、4 项账号输入规则、3 项上传身份规则。验证中文密码的 UTF-8 字节边界、emoji 码点长度、孤立代理项/NUL 拒绝、UUID 缩写拒绝，以及原始字节/时区变化引起指纹变化。

首次打包因 P0 启动的 java -jar 进程占用 Windows JAR 而无法重命名。已仅停止本任务启动的进程，再次完整 verify 成功；未跳过测试或删除产物。当前未保留后端运行实例，需按 infra/README.md 启动。

本轮未修改前端、数据库 schema、真实 .env 或全局工具；因此未重复前端构建与视觉验证。未安装新业务依赖，尚未接入 Spring Session、Flyway 或 MyBatis，不宣称完成真实 PostgreSQL 集成测试。

下一步需用户批准 docs/contracts/p1-migration-review.md 中指定的专用新建数据库和隔离测试目标。之后才能创建正式迁移、连接数据库执行并验证 SQL 事务和并发行为。
