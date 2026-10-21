# 健身记录

纯前端 PWA，用于记录个人健身训练。所有数据存储在浏览器 IndexedDB 中。

## 技术栈

- React 19 + TypeScript
- Vite 8
- Tailwind CSS 4
- Dexie.js（IndexedDB）
- React Router v7
- vite-plugin-pwa

## 常用命令

```bash
npm run dev        # 启动开发服务器
npm run build      # TypeScript 检查 + 生产构建
npm run preview    # 预览构建产物
```

## 目录结构

```
src/
├── components/    # Header、BottomNav、CheckButton
├── pages/         # Home、Exercises、Templates、ActiveWorkout、History、Stats …
├── db/            # Dexie 数据库定义 + 版本迁移 + 默认数据
├── lib/           # date(本地日期键)、weight(每日体重读写)、restDay(自动补休息日)、session/template(归一化)、bodyParts
├── types/         # TypeScript 类型定义
├── App.tsx        # 路由配置
└── main.tsx       # 入口（initDB + ensureAutoRestDay）
```

## 数据模型（v3，四张表）

`exercises` / `templates` / `sessions` / `weights`

- **`weights`**：按**本地日期** `YYYY-MM-DD` 一天一条，是「当天体重」的真身。
  入口在首页「今日体重」卡；`session.weight` 只是冗余镜像（兼容旧数据与备份），**新代码读体重一律走 weights 表**。
  唯一写入口 `src/lib/weight.ts` 的 `setDayWeight`。
- **本地日期键必须过 `src/lib/date.ts`**：`session.date` 存的是 UTC ISO 字符串，
  而「今天/昨天」在 UI 一律按本地日期算。拿 ISO 前 10 位当日期键会在东八区凌晨错一天
  （体重和休息日都会对不上）。任何按天的逻辑（体重、休息日）都要用
  `toLocalDateKey` / `localDateKeyOf` / `localNoonOf`。
- **自动补休息日**：`main.tsx` 在页面加载后跑一次 `ensureAutoRestDay()`，
  昨天无记录且有用库历史时补一条（id `rest-<本地日期>`，存本地正午 ISO）。
  两道闸：一条 finished 记录都没有的库不补；不从用户第一条记录之前的日子补起。
- **备份格式 `version: 2`**，含 `weights`；导入 version 1 旧备份时**不动 weights 表**。

## 部署（Cloudflare Pages）

- 项目名：`workout-app`
- 生产地址：https://workout-app-681.pages.dev
- wrangler 为全局安装，项目内没有 `wrangler.toml`

**AI 可协助部署**（2026-10-15 起，覆盖此前「2026-10-12 起 AI 不碰部署」的约定）。
凭据红线不变：**token 由用户在运行时以环境变量注入**，AI 不把 token 硬编码进任何文件、
不写进 CLAUDE.md、不提交进 git。用户在对话里贴出 token 后，AI 完成部署并提醒其轮换。

认证二选一：`export CLOUDFLARE_API_TOKEN="<token>"`（非交互环境必须）或 `wrangler login`。
Token 由用户提供，**不要硬编码进任何会被提交的文件**。

```bash
cd "d:\CCDevelop\Workout"

# 1. 构建（TypeScript 检查 + 生产构建）
npm run build

# 2. 部署到 Cloudflare Pages
export CLOUDFLARE_API_TOKEN="<token>"
wrangler pages deploy dist --project-name workout-app --branch master
```

一步合并写法：

```bash
cd "d:\CCDevelop\Workout" && export CLOUDFLARE_API_TOKEN="<token>" && npm run build && wrangler pages deploy dist --project-name workout-app --branch master
```

### AI 部署检查清单（每次部署照做）

1. 先 `npm run build`，确认 `tsc -b` 与 `vite build` 都通过。
2. 不设 `WORKOUT_BASE`（CF Pages 走根路径，base 保持默认 `/`）。
3. 确认 `dist/` 顶层**没有** `404.html`（有它会破坏 CF Pages 的 SPA 回退）。
4. `wrangler pages deploy` 出现 `Deployment complete` 后记下 preview URL；
   若提示 `timed out`，**直接重试部署命令，不用重新构建**。
5. curl 验证生产地址返回 200，且首页引用的 `index-<hash>.js` 与本次构建产物一致：
   `curl -s -o /dev/null -w "%{http_code}\n" https://workout-app-681.pages.dev/`
   `curl -s https://workout-app-681.pages.dev/ | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1`
6. 完成后**提醒用户轮换**在对话中暴露过的 token。

### 关键注意事项

1. **base 路径（最容易踩的坑）**
   `vite.config.ts` 中 `const base = process.env.WORKOUT_BASE || '/'`
   - Cloudflare Pages（根路径）→ 用默认 `/`，**不要改**
   - GitHub Pages（`/workout/` 子路径）→ 才需要 `export WORKOUT_BASE=/workout/`
   - ⚠️ 为 GitHub Pages 把 base 改成 `/workout/` 后再部署到 Cloudflare，会导致资源 404 白屏
2. **SPA 深链回退：靠平台默认行为，不要加 `404.html`，也不要加 `_redirects`**
   - Cloudflare Pages 官方文档明确：**输出目录里没有顶层 `404.html` 时，Pages 会把所有未匹配路径按 SPA 处理并回退到 `/`**（即直接返回 index.html）。所以深链 `/history`、`/stats` 开箱可用。
   - 曾经的 `public/404.html` 是给 GitHub Pages 子路径写的，硬编码 `pathSegmentsToKeep = 1`。在 CF Pages 根路径下会把 `/history` 重定向成 `/history/?/`，而它**本身仍是 404**，于是无限自我重定向（查询串每轮增长），页面永远白屏。**已删除**。
   - 也不要加 `/* /index.html 200`：官方文档说明 `_redirects` 里的规则「无论请求是否命中静态资源都会生效」，会把 `/assets/*.js` 也重写成 HTML，导致 `Failed to load module script` 白屏。
   - 若以后真的要回到 GitHub Pages（子路径部署），需要**重新**加一个能正确推导 base 的 `404.html`；但加了它就会覆盖掉 CF Pages 的原生 SPA 回退，两者只能选一个。
3. **部署的是 `dist/` 目录内容**（已被 `.gitignore` 忽略），不是源码
4. **网络超时重试**：Cloudflare API 经常超时（`The request to Cloudflare's API timed out`），直接重试部署命令即可，不需要重新构建
5. **数据安全（项目铁律）**
   - 所有数据存在浏览器 IndexedDB，不要在部署代码里 `clear()` / 重建数据库
   - `src/db/index.ts` 的 `initDB()` 只在空库时播种，迁移用 `bulkPut`，**绝不能加 `clear()`**
   - 改已有数据的结构走 `db.version(N).stores({...}).upgrade()`（只执行一次），不要在 `initDB()` 里做条件判断
   - 类型新增字段都应是可选的（`?`），保证旧数据兼容
   - 从库外进来的数据（备份导入 / sessionStorage 的 preset）当敌意数据：读取边界要过 `normalizeSession`/`normalizeTemplate`，数值消费点要夹（唯一来源 `src/lib/template.ts`）
6. **空值边界（写表单/落库时必守）**
   - `datetime-local` 与 `type="number"` 的值可能是空字符串。`new Date('')` 是 Invalid Date，`.toISOString()` 会抛 `RangeError`，导致记录静默丢失。落库前必须判空。
   - 不要用 `if (arr.length === 0) return` 来跳过写入：UI 已经清空、DB 却保留旧值，会造成「删掉的动作复活」。应该用「是否已完成初始化」来门控，而不是用「数组是否非空」。
   - 区分「休息日」与「训练后动作被删空」：休息日没有 `startTime`，真实训练有。
7. **敏感文件**：`.claude/settings.local.json` 含 token，已在 `.gitignore`。
   **不要 `git add -A`**（会误提交敏感文件），用 `git add <具体文件>` 或 `git add src/ public/ ...`

### 验证部署

部署完成会输出一个 preview URL（形如 `https://xxxx.workout-app-681.pages.dev`）。
生产地址固定为 https://workout-app-681.pages.dev 。
手机端若还是旧版，是 PWA 缓存，关闭页面重开或强制刷新。

### 提交代码（可选，与部署相互独立）

```bash
cd "d:\CCDevelop\Workout"
git add src/ public/ index.html package.json package-lock.json vite.config.ts .gitignore
git commit -m "feat: 描述改动"
```

⚠️ 部署到 Cloudflare **不依赖 git push**，`wrangler pages deploy` 直接上传 `dist/` 即可。
