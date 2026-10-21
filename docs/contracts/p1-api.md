# P1 账号与云备份接口契约

状态：P1 已实现，验证记录见 docs/verification/2026-10-16-p1.md。版本前缀统一 /api/v1；现有 /api/status 继续兼容，状态别名为 /api/v1/system/status。下方表述的接口路径均相对于 /api/v1。

P2 已演进上传协议：新上传返回 202 并包含 jobId，状态 PROCESSING/READY/FAILED，原始文件仍立即可下载。下文 201/NOT_REQUESTED 是 P1 时点的契约；当前任务与统计协议以 p2-processing.md 为准。

## 身份

用户名先 strip，再以 Locale.ROOT 转小写，仅接受 ASCII [a-z0-9_]，3–32 字符；不把它描述为邮箱。密码不 trim、不规范化，最少 8 个 Unicode code point，最多 72 个 UTF-8 字节，拒绝 NUL 与孤立代理项，不静默截断。BCrypt 成本在本机基准测试后固定。

GET /auth/csrf 匿名返回 {token,headerName}，使用默认 HttpSessionCsrfTokenRepository 和框架的掩码 token，客户端放入 X-CSRF-TOKEN；不将 token 存 localStorage。POST /auth/register 使用 JSON；POST /auth/login 使用 application/x-www-form-urlencoded，以便使用标准认证过滤器。注册不自动登录；成功后显式登录。登录成功更新会话 ID 并保存 SecurityContext。登录/退出后重新获取 CSRF token，不能沿用旧值。POST /auth/logout 失效会话并清 Cookie；GET /auth/me 未登录 401。

会话闲置 30 分钟过期，Cookie HttpOnly/SameSite=Lax，生产 HTTPS 才启用 Secure。本地演示注册由显式配置开放；默认关闭。注册、登录按客户端地址与账号双重有界内存限流，失败统一错误，不记录密码。首版单实例限流不是全局限流；X-Forwarded-For 不直接作为可信身份。

CSRF 的依据为 [Spring Security 官方文档](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html)。无 CSRF 的写入在认证前即可能返回 403，不把这种情况误标成“用户名密码错误”。

## 备份

POST /backups：multipart 的 file 与 timezone，加 Idempotency-Key（UUID，大小写可接受但必须标准 36 位写法，统一为 UUID 存储）。file 是原始 UTF-8 JSON，不重新 stringify，不保存客户端文件名。IANA 时区使用 Java 可用区域 ID，允许 UTC，拒绝仅偏移量的 +08:00，且长度最多 64。

上传还需 X-Expected-User，内容是确认页面展示的账号 UUID。它只与服务端认证身份比较，不能授予访问其他用户的权限；其他标签页切换会话时返回 409 ACCOUNT_CHANGED，避免把原账号确认的文件传入新账号。数据所有者仍只来自服务端认证上下文。

上传和下载共享有界传输许可：全进程 2、每用户 1，持有直到响应完成，避免并发下载将多份 20 MiB BYTEA 同时加载到堆。忙时返回 429 UPLOAD_BUSY（同一传输繁忙错误码）；列表与账号读取不占此许可。

请求指纹是 SHA-256(UTF-8("1\n" + rawSha256LowerHex + "\n" + timezone))；契约版本 1。file 字节任一变化或时区变化，都视为不同请求；不是内容去重。首次 201，Location 指向资源；同 key 同指纹重放 200，资源 id 不变；不同指纹 409 IDEMPOTENCY_CONFLICT。P1 不创建任务，projectionStatus=NOT_REQUESTED。

GET /backups：游标分页，默认 20、上限 50，按 created_at DESC,id DESC；返回 id、createdAt、sizeBytes、sha256、formatVersion、timezone、counts、projectionStatus。游标包含时间与 UUID，解析校验，不含 rawBytes。GET /backups/{id} 返回同类元数据；GET /backups/{id}/download 返回 application/octet-stream、固定服务器生成文件名与附件头、no-store，字节与上传一致，不触发本地恢复。资源不存在或不属于当前用户统一 404。

## 文件边界

文件 20 MiB；multipart 请求 21 MiB。校验原始 UTF-8、单一根对象、无尾随 token、重复 JSON key 拒绝。支持显式 version 1/2/3；无 version 拒绝并提示先在现有前端导入、再导出 v3。未知附加字段保留原字节，但同样受所有解析预算限制。

JSON 最大嵌套 32、最大 token 数 100 万、最大数字文本 32、普通字符串最多 16384 字符。session.photos 每 session 最多 3 项，仅该路径允许最多 8 MiB 字符串；全文件限额仍为 20 MiB，不截断照片。流解析时应用预算，不等整棵树构建后再计数。外层数组上限：动作 5000、模板 1000、训练 20000、体重 20000；全备份训练组上限 100000。字段具体语义在上传校验器实现前补全为共享夹具，不复用前端宽松归一化来修改原文件。

所有支持版本要求 exercises/templates/sessions 数组，v1 可缺 weights，v2/v3 要求 weights 数组。外层 ID 非空、最多 128 字符，同类 ID 不重复；weights 日期不重复。历史 exerciseId 引用缺失允许保留；没有动作定义不丢弃 session。可选旧字段不强制补值。非法数值/类型明确报 422，校验不会更新本地库或重写原字节。

注册 JSON 请求与登录表单均限制 4 KiB。限流为每个服务端观察到的地址每 10 分钟 5 次注册/30 次登录、每账号 10 次登录，最多保存 4096 个有效窗口。Nginx 入口下地址限流由入口共享，不声称已实现真实客户端 IP 限流；账号维度独立。未信任 X-Forwarded-For。重启后窗口清空。

输入数值均须有限：组 weight 0–2000 kg、reps 整数 0–1000、RPE 6–10 且为 0.5 步进；体重 (0,1000] kg、duration 整数 0–604800 秒、distance 0–10000 km、restSeconds 整数 30–600。缺少可选重量/次数允许，参与计算时贡献 0；不能把负数夹成 0 后接受。

## 错误与验证

401 未登录；403 CSRF 或注册关闭；404 归属不存在；409 幂等/用户名冲突；413 超限；422 内容/字段校验失败；429 速率或存储额度；503 依赖不可用。错误统一 Problem Details + code + traceId，可带字段路径但不回显密码、照片、完整 JSON 或 SQL。

验收使用真实 PostgreSQL：两用户隔离；同 key 并发重放/冲突；额度竞争；写入故障回滚；下载字节摘要一致；退出后旧会话失效；输入预算和旧版本兼容。前端上传先显示当前云账号和文件计数，用户明确确认上传；云账号不自动认领本地数据。
