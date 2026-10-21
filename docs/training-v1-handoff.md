# 账号训练首版交接

日期：2026-10-17。范围：服务端训练核心、独立账号缓存与隔离环境验收；不是当前8088服务升级或公网发布。

## 用户能做什么

从首页进入“账号训练”，登录并明确启用后，可以开始力量/有氧训练，添加动作与组、填写重量次数和备注、结束训练。复用原训练页及计时/休息交互，新记录进入账号队列自动保存到服务端。

离线可继续记录并刷新恢复；恢复连接且应用打开时自动补传，有界失败后可点“同步并刷新”。页面区分本地待同步和已同步，不将失败当成功。账号历史可以在另一设备登录后拉取；同一训练首版限原设备编辑，同设备两标签也有编辑保护。

可以补录已完成力量/有氧训练，显式记录休息日；已完成账号训练暂只读。原有本机训练、历史、模板、体重、照片和完整备份不被自动认领。

“导入旧训练记录”从自有不可变云备份预览、确认；支持1000条源训练/批，报告未结束、冲突及不支持项。重复提交不新增同一记录；模板、体重和照片仍留原库及原备份，不承诺换设备全量恢复。

## 如何运行首版预览

先启动已有Docker Linux引擎，项目根目录执行：

```powershell
.\infra\start-training-preview.ps1
```

此入口使用自己的Testcontainers数据库、随机回环URL、脚本模型和空真实模型凭据，不连接当前项目库。控制台输出ACCEPTANCE_READY目录，查看该目录ready.json中的URL。输入STOP结束；最多运行30分钟，结束后隔离云库回收，只用于合成数据演示。浏览器合成缓存和忽略目录证据保留，不自动清理。

实际长期使用需要独立审阅并批准目标库新增表迁移、升级server/web和运行时模型配置安排。当前Compose默认关闭训练写接口，不能仅设置开关就假设数据库已准备好；现有服务和密钥不在本轮读取或改写。

## 关键入口

- 账号页面：`/account-training`、`/account-session/:accountId/:sessionId`、`/account-add-session/:accountId`。
- 服务端：`workouts/WorkoutController`、`WorkoutService`、`WorkoutMapper`、`WorkoutInput`、`WorkoutImportService`。
- 前端：`src/data/accountTraining.ts`、`src/sync/trainingSync.ts`、`src/sync/trainingSession.ts`；原ActiveWorkout/AddSession复用仓储。
- 数据库审阅：[新增SQL](contracts/r2-training-schema.sql)；设计变更：[ADR](adr/0005-server-managed-training-v1.md)。

## 验证与交付边界

最终实际结果见 [验证记录](verification/2026-10-17-training-v1.md)；不把旧版102项测试当成新功能证据。

手机实机、安装式PWA、账号全量历史改删、跨设备接管、模板/体重/附件同步、基于最新业务数据的统计和Agent、生产库迁移及公网HTTPS尚未完成。当前统计/Agent仍基于用户选定的旧快照；账号历史卡片仅提供本条训练摘要，不冒充完整实时统计。

已解决：备注失焦前刷新丢失窗口、重复响应覆盖较新草稿、短训练取消后的远端活动残留、过期标签重新覆盖新编辑、非法补录进入只读失败状态。所有修复的保证都限已覆盖的场景，不声称无缺陷或任意并发/负载能力。
