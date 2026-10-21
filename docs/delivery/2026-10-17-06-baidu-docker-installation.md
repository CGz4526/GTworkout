# 百度云Docker安装完成

日期：2026-10-17。

## 完成

- 用户追加专用公钥后，使用指定IdentityFile、IdentitiesOnly、BatchMode和严格主机公钥检查成功登录目标root账号。私钥仍仅在本机，未读取或传输用户登录密码。
- 确认Ubuntu 24.04 amd64、79GB系统盘，安装前余量约71GB。通过Docker官方APT源及核对签名公钥指纹安装Docker Engine 29.9.1、Compose 5.6.0，以及其containerd/Buildx依赖；Docker服务active、开机启动enabled。
- 新增infra/bootstrap-docker-ubuntu.sh，限定已授权的Ubuntu 24.04 amd64；冲突包不自动删除，现有不同Docker源不覆盖，不升级全系统，不创建项目数据库或启动应用。

## 实际验证

- 通过SSH使用bash -n检查脚本语法。
- 安装流程真实执行完成；公钥指纹校验流程在root专用运行时目录复核通过。首次校验因默认GPG目录不存在中断，修复为专用目录；诊断时产生的非敏感APT keyrings/trustdb.gpg保留，不自动删除。
- 云主机直接从Docker Hub拉取hello-world发生连接超时，不能宣称已解决云主机直接访问Docker Hub的问题。
- 在本机获取官方library/hello-world镜像，导出传输后核对SHA-256、导入并比较镜像ID，运行无网络、无宿主端口/卷的专用容器，实际输出Hello from Docker并正常退出。仅自动回收该一次性检查容器；镜像与传输归档保留，不操作其他资源。
- 最终Docker active、enabled，运行中容器列表为空。没有把Docker安装成功当作Workout业务验收。

## 证据与边界

脱敏安装日志、运行检查及镜像校验元信息写本机.cache/remote-access/本次唯一目录。云端官方测试镜像传输归档位于/var/tmp/，签名检查元数据位于/run/唯一目录，不含私钥或真实业务数据，不自行清理。

本批没有执行项目数据库迁移、注入数据库/模型凭据、公开部署Workout或改动原本机8088服务。Docker守护进程安装会创建自身网络及相关规则，未发布应用或数据库公网端口。

## 下一步

确认域名与备案状态，准备Linux正式部署配置、HTTPS及证书续期、版本化训练表迁移和备份方案。镜像可沿用本机构建后传输的方式，不依赖云主机直接连接Docker Hub。系统安装以外的目标库迁移及正式发布仍按AGENTS.md分别授权。
