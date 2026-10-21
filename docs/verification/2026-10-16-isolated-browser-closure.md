# 隔离浏览器闭环与站点不可达验收

日期：2026-10-16。模式：`SCRIPTED_NO_REAL_MODEL`。这是一轮实际浏览器交互，服务端业务、PostgreSQL、确认 API 和前端 Dexie 均为真实实现，只有模型响应为确定性模拟；不将结果计作真实 DeepSeek 效果。

## 隔离方式

新增显式测试入口 `BrowserAcceptanceEnvironment`，不随默认 verify 启动，不进入生产 JAR。它创建自身 Testcontainers PostgreSQL，在回环随机端口运行 Java 和静态入口，仅代理自身后端；Cookie 名唯一，浏览器 origin 与当前 localhost:8088 不同。模型凭据在最高优先级测试配置中置空，并用 Primary 模拟网关替代调用路径，真实请求数 0。

测试入口服务当前 dist，页面标题明确为“Workout 隔离验收 · 模拟模型”；它不是当前 Nginx 容器，也不能据此重述生产入口配置已完成新的测试。Nginx/Compose 有此前独立验证。

## 实际页面结果

1. 在全新 origin 初始化默认动作/模板，通过页面导出 48 个动作、7 个模板、0 训练、0 体重。没有读取原浏览器库或导入覆盖。
2. 注册独立合成账号，上传该默认数据并构建 READY 快照。选择深蹲、三天、每次 60 分钟、复盘 2026-10-01 至 2026-10-16。
3. 页面提交模拟任务，状态 SUCCEEDED，2 次模拟响应、1 次只读比较工具，生成 3 个模板，每个估时 12 分钟。没有真实模型请求或 token 计费。
4. 记录任务号，刷新页面，重新选择快照并输入编号取回同一草案。
5. 点击确认并应用，页面提示新增 3 个模板；重复应用提示已应用。通过模板编辑 UI 修改第一个名称，再取回同一已确认草案应用，修改被保留。
6. 页面导出验证：模板总数 10，`ai-plan-` 模板恰好 3 个且 ID 唯一，编辑名称仍在。由导出文件核对，不通过浏览器隐藏状态直接读取或写入 IndexedDB。
7. 标准输入暂停本次静态入口，日志确认 `WEB_PAUSED`；未停止当前 8088 服务。此时在浏览器刷新仍能打开首页，进入历史→添加记录，保存“隔离离线保存验收”，再次刷新后仍存在。
8. 站点仍不可达时打开云服务，明确显示“云服务暂不可用，本地训练和备份仍可使用。”；回到历史记录仍在。
9. 恢复自身入口后核对记录详情：深蹲 20kg×12，1 组；本地统计容量 240。导出文件确认仅新增这一条合成训练。
10. 切换至第二个空合成账号，其云列表为空，本地记录和已编辑模板保留，符合云账号与本地库分离的约定。

日期控件最终通过可访问性日期输入操作完成；本轮没有改动产品日期逻辑。工具首次使用通用 fill 未保留日期，未把这一自动化适配问题冒称为应用缺陷。

## 证据

唯一目录 `.cache/browser-acceptance/isolated-da73d92a-1675-4aee-9a27-98b3b0b1f7e3/`：

- `ready.json`：随机入口与明确模拟模式，不含凭据。
- `result.json`：2 次模拟调用，真实请求 0。
- `browser-result.json`：通过页面导出独立核对的 10 模板、3 个稳定 Agent 模板、保留编辑、1 条 20×12 合成记录。
- `plan-applied.jpg`、`templates-preserved.jpg`、`offline-history.jpg`：实际页面证据。

两份默认/最终合成导出保留在本机 Downloads，未自动清理。隔离标签已关闭，测试 Java/HTTP 服务正常退出，测试 PostgreSQL 已由生命周期回收；测试 origin 的本地数据未删除。当前 workout 三服务继续 healthy，真实模型计数保持 29/30。

## 重复执行

先构建前端和测试 classpath，在 server/ 中执行：

```powershell
$probeClasspath = 'target/test-classes;target/classes;' + (Get-Content target/test-classpath.txt -Raw).Trim()
& "$env:JAVA_HOME\bin\java.exe" -Xmx256m -cp $probeClasspath io.github.cgz4526.workout.assistant.BrowserAcceptanceEnvironment
```

输出 ACCEPTANCE_READY 后，在该批次 ready.json 读取入口，通过浏览器操作。原终端输入 `PAUSE_WEB` 暂停自己的入口，`RESUME_WEB` 恢复，`STOP` 结束并回收测试环境。最长运行 30 分钟。不要用当前 8088 项目的任务号或浏览器数据替代隔离夹具，不给该入口注入真实模型密钥。

完整 Maven Wrapper verify 再次通过：102 项（78 单元、24 PostgreSQL/HTTP 集成），0 失败/错误/跳过；日志 `.cache/browser-acceptance/final-verify.log`。该显式入口不虚增自动化测试数量。

## 结论与边界

本机版关键页面闭环已具备分层证据：真实 DeepSeek 合成样本验证后端生成；模拟模型环境验证草案页面流转与本地应用；站点不可达验证预缓存后的桌面浏览器读取和保存。它们不是同一次真实供应商到浏览器的完整新调用，也不等于手机飞行模式或所有浏览器的首次离线启动。

手机实机、安装式 PWA、无预缓存首次访问和高并发生产表现未覆盖，作为交付限制保留。没有新增付费预算、公开部署、改系统网络设置或清理用户数据。
