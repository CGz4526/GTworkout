# GTworkout 独立仓库上传准备

用户要求把当前完整工程上传到新仓库 `CGz4526/GTworkout`，原 `workout` 仓库保留纯前端代码。本次仅操作当前目录的新Git仓库，不修改旧远端，不发布运行中的站点。

## 已准备

- 在当前工程初始化独立Git仓库，主分支main；按显式清单纳入前端、后端、测试、部署脚本与文档。
- README命名为GTworkout，并说明完整工程与原纯前端仓库的区别。
- 首轮273个文件约1.75MB，排除node_modules、dist、server/target、.cache、.tools、.workbuddy-ai及.env；凭据模式检查没有命中真实密钥格式、GitHub token、私钥或带凭据URL。新增本说明后文件数会增加。
- 本地提交使用GitHub noreply形式邮箱，避免公开本机Git配置中的个人邮箱。
- `git diff --cached --check`发现4处已有空白格式问题，其中一处在不可修改的V1迁移末尾，因此不为格式检查改写历史SQL；不是编译或功能失败。
- 前端构建通过，保留原有包体积提示；本批不更改业务实现、后端迁移或CI/CD，未重新运行后端全量验证。

## 当前阻塞与下一步

本机GitHub CLI尚未登录，尚未创建远端仓库或推送。用户需在自己的终端运行 `gh auth login --hostname github.com --git-protocol https --web`，通过GitHub官方页面完成登录；不要在聊天中提供密码或token。登录后核验账号为CGz4526及新仓库名未被占用，再创建独立仓库并执行首次推送；若同名仓库已存在，先检查内容，不覆盖或强推。

未改动现有训练、数据库、服务器、旧GitHub仓库或任何凭据文件；扫描摘要保留在忽略目录 `.cache/github-publication/20261021-first-upload/`，不自动清理。
