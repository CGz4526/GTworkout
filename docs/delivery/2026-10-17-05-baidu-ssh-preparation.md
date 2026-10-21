# 百度云SSH接入准备

日期：2026-10-17。

用户已授权创建项目专用SSH密钥及后续远程操作；此前Docker/Compose安装已单独获批。

## 完成

- 通过SSH读取服务器ED25519主机指纹，与用户在百度云终端提供的指纹一致后，保存至本项目忽略目录中的专用known_hosts；未关闭主机身份校验。
- 在本机用户.ssh目录生成独立Ed25519密钥，私钥仅当前Windows用户与SYSTEM可访问；没有写入仓库、上传服务器或输出私钥。
- 更新AGENTS远程接入约定。连接元信息保留在.cache/remote-access/，不自动删除。

## 检查与边界

专用主机文件指纹及私钥文件ACL已检查。Windows ssh-keyscan遇到密钥交换兼容问题，改用SSH明确确认已核对的完整指纹；没有安装额外客户端。服务器尚未添加新公钥，因此尚未完成专用密钥登录，也没有执行Docker安装、数据库迁移或公开部署。

## 下一步

用户在现有云终端追加本次带restrict选项的公钥，保留已有authorized_keys内容。完成后使用指定IdentityFile、IdentitiesOnly及StrictHostKeyChecking进行连接，先只读检查，再执行已获批的Docker/Compose安装。restrict关闭此密钥的PTY、端口转发等功能，仍可执行root非交互命令；不得将其描述为权限受限的普通账号。
