# GTworkout：训练记录、版本化云备份与教练 Agent

这是从原纯前端训练记录应用继续演进的完整工程版本。原 `workout` 仓库保留纯前端版本，本仓库维护前端、Java后端、教练Agent及部署与验证文档。当前主要在本机开发，公开源码不代表生产服务已经上线。

React PWA 保留本地训练体验，Java 后端提供独立的云账号和不可变备份。断网或未登录时仍可记录训练；云端不自动认领、上传或覆盖当前浏览器数据。

## 当前可用

- 原有力量/有氧训练、模板、体重、历史和 JSON 导入导出。
- 用户注册、登录、退出，Spring Session JDBC 会话与 CSRF。
- 选择已导出的 JSON，核对账号与时区后上传；版本列表、原始文件下载。
- 用户作用域幂等键、请求指纹、数据库唯一约束与用户行锁。
- 原始字节保存，未知合法字段保留；输入、传输并发和存储额度有界。
- Docker 三服务同源部署、健康检查、命名数据卷与重启持久化。
- PostgreSQL 持久任务、租约恢复与执行代号；READY 原子可见的训练投影。
- 指定快照的训练次数/天数、有效组、容量、体重、训练分页和动作趋势。
- DeepSeek 有界只读工具调用、确定性计划校验、持久草案确认与幂等添加本地模板。

当前增加 P3 教练流程：配置模型后，在“查看快照分析”中选择复盘日期、允许动作、天数和时长，生成计划草案，确认后添加到本地模板。旧备份点击“生成快照分析”后才处理；云备份不是实时同步。

## 本机启动

需要已有 Docker Desktop/Linux 容器引擎。PowerShell 中运行：

```powershell
.\infra\start-local.ps1 -EnableRegistration
```

打开 http://localhost:8088 ，进入数据备份 → 云服务与连接状态。首次启动下载镜像与依赖；注册开放只用于本机演示，默认配置关闭注册。密码由脚本随机生成并交给本项目 Docker，不创建 .env。入口仅绑定 127.0.0.1。

切换电脑、浏览器或 origin 前，先从旧站点导出本地 JSON 并保留副本。

## 技术与结构

Java 17 / Spring Boot 4.0.8 / MyBatis 4.0.0 / PostgreSQL 17.6 / Flyway / Spring Security / Spring Session JDBC；React 19 / TypeScript / Vite 8 / Dexie。

| 目录 | 职责 |
|---|---|
| src/ | 本地优先 PWA，src/api/ 为同源云服务客户端 |
| server/ | Java 模块、SQL 迁移、单元与 PostgreSQL 集成测试 |
| infra/ | Dockerfile、Compose、Nginx、本机启动与合成冒烟脚本 |
| docs/ | 实施方案、ADR、接口/数据契约与真实验证记录 |

## 验证与文档

前端运行 npm run build 和 npm run lint；后端在 server/ 下运行 .\mvnw.cmd verify。完整 verify 需要 Docker，会创建独立测试数据库，不连接开发数据卷。镜像构建运行 package 的单元测试，不能替代 verify 的数据库集成测试。

- [本机工程版最终交接](docs/delivery-handoff.md)
- [隔离草案闭环与站点不可达保存](docs/verification/2026-10-16-isolated-browser-closure.md)
- [运行、停止与凭据说明](infra/README.md)
- [本机交付清单与剩余步骤](docs/release-readiness.md)
- [实际浏览器验收与提示修复](docs/verification/2026-10-16-browser-acceptance.md)
- [用户验收单](docs/user-acceptance.md)
- [当前镜像空环境部署验证](docs/verification/2026-10-16-fresh-deployment.md)
- [阶段进度与下一步](docs/progress.md)
- [本批交付简报](docs/delivery/2026-10-16-09-local-handoff.md)
- [Agent HTTP 隔离与并发验收](docs/verification/2026-10-16-assistant-http-isolation.md)
- [真实样本审阅与 Web 响应检查](docs/verification/2026-10-16-assistant-sample-review.md)
- [固定 Agent 评测与云会话验证](docs/verification/2026-10-16-assistant-evaluation.md)
- [P4 冷恢复、后端回退与负载](docs/verification/2026-10-16-p4.md)
- [运维与演练手册](docs/operations-runbook.md)
- [当前架构](docs/architecture.md)
- [演示与简历证据](docs/demo-guide.md)
- [P3 测试与真实模型联调](docs/verification/2026-10-16-p3.md)
- [P3 模型、任务与草案契约](docs/contracts/p3-assistant.md)
- [数据库隔离恢复验证](docs/verification/2026-10-16-recovery.md)
- [P1 验收记录与已知边界](docs/verification/2026-10-16-p1.md)
- [P2 验收与真实进程恢复记录](docs/verification/2026-10-16-p2.md)
- [P2 任务与统计契约](docs/contracts/p2-processing.md)
- [P1 接口契约](docs/contracts/p1-api.md)
- [数据库迁移设计与隔离范围](docs/contracts/p1-migration-review.md)
- [P1 工程决策](docs/adr/0002-p1-delivery.md)
- [整体实施方案与后续 P3/P4](docs/backend-implementation-plan.md)

目前未公开部署；数据库隔离恢复、应用冷恢复、特定后端版本回退及本轮 9 个真实模型合成生成样本已验证，固定 30 场景离线与当前 15 项会话检查通过，实际浏览器已验收合成云流程、退出同步和响应式显示。隔离模拟模型已完成草案页面应用与编辑保留，站点不可达时本地保存/刷新也通过；手机安装式 PWA、建议质量扩展和完整前后端回退仍有明确限制。性能与并发行为只以验证报告记录的环境和数据规模为依据。
