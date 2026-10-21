# 当前镜像空环境部署验收

日期：2026-10-16。使用本机已有的交付镜像，在独立 Compose 项目 `workout-fresh-116baf3cee824148a931137b45dcafd1` 中验证，不读取当前项目数据库或浏览器数据。

## 实际结果

`infra/fresh-deployment-drill.ps1` 执行成功：

- Compose 5.1.3 解析覆盖配置成功，三服务均无宿主端口、无持久卷或宿主目录挂载；PostgreSQL 数据目录使用最大 256 MiB 的 tmpfs。
- 使用本机现有 web/server/PostgreSQL 镜像启动，三服务全部 healthy，容器镜像 ID 与启动前记录一致。
- 新库执行既有 V1–V4，最终版本 4；账号、备份和 Agent 任务数量均为 0。
- 在本次 web 容器内请求 `/api/status`，通过 Nginx 访问本次 Java 服务，identity/backup/training=true，assistant=false；模型配置显式为空，新增真实模型请求 0。
- 结束后检查归属并回收本次三容器和网络；现有 workout 服务没有被重建、停止或挂载到演练中。

凭据由运行时随机生成，不写 `.env`、覆盖 YAML 或结果文件；Compose 展开配置只在内存验证。演练目录保留静态覆盖配置与脱敏结果，不自动清理本机文件。

## 镜像与证据

| 服务 | 本次实际镜像 ID |
|---|---|
| web | `sha256:c15aee8d87dc38e447f7eee9b576b392e6e3179f31e3ede5eef0d3e17c169cc2` |
| server | `sha256:d18146afefb90ec890c43229ab545fd7f2a8389d4b43986e1375daea04db4993` |
| db | `sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94` |

脱敏报告：`.cache/workout-fresh-116baf3cee824148a931137b45dcafd1/result.json`，passed=true、cleanupCompleted=true，共 28 条配置/启动/归属/数据/API 断言。控制台记录 `.cache/fresh-deployment-drill.log`。

复现命令：

```powershell
.\infra\fresh-deployment-drill.ps1
```

需要已有 Docker、本机镜像以及支持 `!reset` 的 Compose；不自动安装工具、下载镜像或重新构建。脚本禁用模型，不能用它证明真实模型配置已部署。默认启动仍使用 [运行说明](../../infra/README.md) 中的一键脚本。

## 边界

本次是“当前已构建镜像 + 空库”的启动验证，不是换机后从源码重新下载依赖、跨平台部署、注册上传全流程或浏览器交互测试。已有独立证据覆盖镜像构建、HTTP 业务、持久化重启、冷恢复和特定后端回退；不能用这些结果宣称完整前后端回退或生产部署完成。

本批只增加基础设施演练脚本与文档，未修改 Java/React 业务逻辑；不重复运行上一批已通过的 102 项 verify。演练后当前三服务仍 healthy，真实模型预算保持 29/30。
