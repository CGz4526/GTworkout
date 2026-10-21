# P0 HTTP 契约

所有 API 走同源 /api。响应禁止缓存；每次请求由服务端生成 UUID traceId，响应头 X-Trace-Id 返回，不接受外部 traceId 直接写入日志。

GET /api/status：匿名可读，200 application/json。

```json
{"stage":"P0","service":"workout-server","capabilities":{"identity":false,"backup":false,"training":false,"assistant":false}}
```

此接口只说明 Java 底座可达，不声称数据库、账号或模型已就绪。非 JSON 的 Accept 返回 406。客户端请求 5 秒超时，响应字段类型不符、HTML 回退或 HTTP 错误均按不可用处理；不读写 IndexedDB。

GET /actuator/health/liveness、GET /actuator/health/readiness：容器内部使用；当前无数据库依赖，200。Nginx 不转发 Actuator。P1 引入 PostgreSQL 时同步增加数据库就绪检查。

其余请求：匿名读取返回 401；无 CSRF 的写入返回 403。未提供任何账号、登录表单、Basic 登录或默认密码；账号接入前客户端不发送写请求。鉴权错误为 application/problem+json，包含 type、title、status、code、traceId；不包含堆栈或请求数据。

P1 接入会话认证后，再定义会话、CSRF 获取与刷新、字段级错误、幂等请求和资源归属契约。当前 status 客户端不能当作未来通用写请求客户端使用。
