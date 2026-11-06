# 🎲 一起玩 · 游戏大厅

在同一个公共房间中，与朋友游玩奶酪大盗、Holdem 线下筹码管理和瞎掰王。房主在一局结束后切换游戏；切换到 Holdem 会开启新的筹码局。

## 线上部署

自 2026-11-06 起，正式环境统一部署到上海机器，后续发布使用以下目标。

- SSH 使用 `ssh root@111.229.79.183`。
- 项目目录为 `/opt/chesse`，Compose 项目名为 `chesse-shanghai`。
- 公网入口为 `https://111.229.79.183`；原 HTTP 入口（含 8000 端口）自动跳转 HTTPS。
- 服务器 `.env` 设置 `COMPOSE_PROJECT_NAME=chesse-shanghai`、`LOBBY_PORT=8000` 和 `COMPOSE_FILE=docker-compose.yml:docker-compose.https.yml`。
- 成都旧节点 `aliyun-chengdu-head`（Tailscale 当前名称 `aliyun-headscale`，`100.64.0.1`）已退役，后续发布使用上海节点。

优先在开发机构建并验证镜像，再传送到上海服务器。当前运行镜像为 `chesse-shanghai-backend:latest`、`chesse-shanghai-frontend:latest`，Redis 使用 `docker.m.daocloud.io/redis:7-alpine`。镜像导入并更新源码后，在服务器执行：

```bash
cd /opt/chesse
docker compose up -d --no-build
docker compose ps
```

上海实例使用独立的 `chesse-shanghai_lobby_redis_data` 数据卷。发布时保留现有卷，后端保持单 worker。按项目当前发布约定，完成本地代码检查后直接发布上海线上，不再启动隔离体验环境；会创建房间或重启服务的冒烟脚本不得指向线上。

## 启动

需要 Docker 和 Docker Compose：

```bash
docker compose up -d --build
```

打开 `http://localhost:8088`。可通过 `LOBBY_PORT=18088 docker compose up -d --build` 指定宿主机端口。服务包括大厅与三个游戏前端的 Nginx 网关、FastAPI 后端和 Redis。Python 依赖安装与前端包安装使用 Dockerfile 中配置的镜像；如网络环境不同可调整镜像源。

```bash
docker compose ps
docker compose logs -f backend
docker compose down
```

Redis 使用 Compose 独立的 `lobby_redis_data` 卷，不读取旧游戏的 Redis 键。普通 `down` 不删除卷；避免使用 `down -v`，否则会清除大厅数据。只有一个后端进程应使用同一份大厅数据；当前进程内锁假设单 worker。

若机器已缓存其他基础镜像，可设置 `PYTHON_IMAGE`、`NGINX_IMAGE`、`REDIS_IMAGE`。例如在 dify 机器的隔离开发实例中：

```bash
LOBBY_PORT=18088 REDIS_IMAGE=redis:8-alpine NGINX_IMAGE=nginx:latest \
PYTHON_IMAGE=python:3.12-slim-bookworm docker compose -p chesse-integration up -d --build
```

## 游戏大厅

首次打开必须先输入昵称或点击“随机”并确认，之后首页直接展示房间列表，按房主头像与昵称找到朋友，点击即可加入。创建/加入房间不再显示昵称和头像表单；有密码时只需输入密码。房间展示游戏、人数、阶段和密码锁标记；无需扫码或输入房间号。首页一键创建无密码空房，在房间内选择游戏；点击游戏入口则直接创建对应游戏的无密码房间。密码只能在房间内由房主通过“更多 → 设置房间密码”设置（4–20 位非空白字符）。列表每 5 秒刷新，支持手动刷新。

- 公共房间最多 12 人，默认按加入顺序入座，超出游戏上限的成员观战。玩家可选择参与或观战，房主可调整参与名单。
- 奶酪大盗支持 5–8 人、瞎掰王支持 3–9 人、Holdem 支持 2–12 人。只有入座玩家需要准备。
- 全员在线且准备后，由服务端执行 3 秒倒计时并自动开局。取消准备、参与者离线会取消倒计时；设置或参与名单变化会让所有人重新准备。新观众不影响倒计时。
- 初次进入游戏不需要再次准备。Holdem 后续每手的准备、补码流程和瞎掰王每轮选题后的查看确认仍在游戏内进行。
- 游戏进行中新成员可加入候场并自行离开，不参与当前对局，也不能连接游戏或查看私密信息。候场等待整局结束（Holdem 为整场筹码局），房主返回等待室后主动入座；保留原座位并清空准备。当前对局成员仍需结束后离房，已有成员可刷新重连。结算后“再来一局”“换游戏”分开显示，Holdem 重开整场明确提示重新发放初始筹码。
- 房主可在等待室转交房主或移出成员；被移出者本房间内不能重新加入。房主离线 60 秒后转交给最早加入的在线成员，进行中的对局延后到结束再处理。
- 房间全员离线满 15 分钟后自动解散，后台每 30 秒检查；期间任何成员重连会清零计时。大厅与游戏连接均纳入在线判定，打开页面但暂未操作不算离线。大厅连接 75 秒没有收到应用消息时会主动断开并进入重连，避免失联设备长期占用在线状态。解散清理该公共房间、关联对局及成员房间映射，不影响保存在设备上的昵称头像；服务重启保留已开始的离线计时，旧数据首次升级给予完整宽限时间。
- 同设备多标签页以最新连接为准，旧标签页暂停重连。后端重启保留已有对局，取消尚未完成的开局倒计时并清空准备。
- 同一浏览器通过服务端签发的匿名设备凭证记住身份，通过本地存储记住昵称与头像，刷新、重连或换房自动复用。点击头像可修改，昵称输入框支持从 100 个候选昵称随机生成不带尾号的昵称，优先轮完候选池再重复并避开当前房间内已用名字，首次设置不能跳过，可手动输入或点随机；保存后随时可以从右上角修改。房间内修改同步给所有成员；游戏中须结束后修改。清除浏览器数据、无痕模式、更换浏览器视为新设备，不提供账号或跨设备同步。凭证保存在 HttpOnly Cookie 中，清除 Cookie 会产生新身份。
- 房主可在等待室设置、修改或移除密码；使用 scrypt 哈希保存，所有公开接口不返回密码或哈希。已加入成员重连无需密码，主动离房后再加入需重新验证；被移出成员不能通过密码绕过封禁。
- 手机竖屏布局使用统一底部弹层，游戏中查看房间不会卸载对局。身份默认隐藏，切后台或查看公共房间时遮蔽；操作等待服务端确认，断线时不重放下注或投票。

### 公共接口与兼容

`GET /lobby/games` 提供人数、入口和设置描述；`GET /lobby/rooms` 返回房间摘要列表，包含 `id`、`owner_name`、`owner_avatar`、`game_id`、`stage`、`count`、`capacity`、`created_at`、`has_password`、`joinable`，不返回成员 ID 或游戏私有状态。可加入房间优先，游戏中候场其次、满房最后，组内按创建时间倒序和 ID 排序。`GET /lobby/rooms/{id}/preview` 返回同样的单房摘要。房间状态包含 `stage`、`seats`、成员 `ready`、`revision` 和服务端倒计时截止时间。状态通过房间 WebSocket 推送，客户端每 5 秒请求刷新作为对局阶段同步补偿。

`POST /lobby/rooms` 和 `/rooms/{id}/join` 接受可选 `password`。`POST /rooms/{id}/password` 接受 `{player_id,password}`，空密码移除限制；`POST /rooms/{id}/profile` 接受 `{player_id,name,avatar}`，更新当前成员资料。以上路径均在 `/lobby` 下。

`POST /lobby/rooms/{id}/game` 只保存配置，不再直接创建游戏。`/seat` 设置入座状态，`/ready` 使用显式布尔值及配置版本，`/return` 由房主在结算后返回等待室，`/manage?action=transfer|kick` 管理成员。全部准备后由服务端创建唯一会话，客户端无法跳过准备直接开局。

房间增加 `password_hash`、`created_at`、`pending_member_ids` 内部字段；旧房间缺省为无密码、创建时间 0、无候场成员。公共状态只允许明确列出的字段，包含 `has_password` 与候场名单，不包含密码哈希。旧房间字段读取时补齐，保留已有对局及 Redis 命名空间。所有 API 和等待室前端需一起发布；旧版大厅脚本不兼容新版准备流程。入口 JS/CSS 使用版本参数及重新验证缓存。Redis 和后端继续使用单 worker，禁止删除已有卷。

## 前端架构与开发

平台采用单一 Vite 构建及根目录依赖。`lobby-web/` 是大厅入口；`web/platform/` 管理统一主题、身份、导航及游戏生命周期；`web/games/` 是游戏模块。德州扑克、奶酪大盗和瞎掰王均直接挂载在当前页面，不使用 iframe。React 游戏共用同一份运行库；游戏代码与样式按需加载，大厅首屏不会下载全部游戏。

每个游戏导出 `mount(context, element)` 并返回清理函数。平台传入当前房间、服务端签发的玩家身份、局号、连接状态回调、返回房间回调和隐私遮蔽信号。换局/离房时统一释放连接、事件和计时器；查看房间或切换主题保留当前游戏实例。游戏使用 Shadow DOM 限定样式范围，共享 CSS 变量随主题即时继承。德州的 Zustand 状态按局创建，不在不同房间之间共享。

新增游戏需在 `web/platform/games.tsx` 注册一个懒加载入口，在后端游戏目录及运行时注册规则；不需要新增独立包、路由应用或构建流水线。

当前网页插画、头像和筹码图片位于 `web/public/`，未在页面使用的插画原稿与提示词保存在 `artwork/`，不打入线上镜像。

顶部月亮/太阳按钮切换亮色和暗色，默认亮色。选择保存在当前设备，并同步其他标签页。暗色使用德州紫灰配色；所有游戏和弹层共用主题。平台共享昵称、头像和身份凭证，游戏不再另行生成设备身份。

```bash
npm ci
npm test
npm run typecheck
npm run build
(cd backend && conda run -n chesse-dev python -m unittest discover -s tests -v)
```

完整服务通过 Docker Compose 提供；本地只构建和运行静态检查，按约定直接发布上海线上。前端浏览器回归使用构建产物及协议模拟，不创建线上测试房间：

```bash
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chrome node scripts/smoke_platform.cjs
```

后端多人冒烟、重启和数据恢复脚本位于 `scripts/`，会创建房间或重启服务，不得对线上运行。

## 游戏规则

1. **组局**：5–8 人创建或加入房间，全部准备后开始；房主可选择是否启用呆呆鸟。
2. **夜晚**：玩家按住查看身份卡和骰子，松手后隐藏；本局看过一次后即可进行夜晚行动。玩家按骰子点数醒来。独自醒来的瞌睡鼠可以偷看一人的骰子；同时醒来的玩家可以看到彼此。大盗偷走奶酪并选择一名共犯，共犯与大盗同一阵营。
3. **呆呆鸟（可选）**：呆呆鸟和大盗知道彼此身份。呆呆鸟选择一名假共犯，让对方误以为自己是大盗的共犯；若大盗选择同一人，该玩家是真共犯。呆呆鸟和大盗只能互相投票。
4. **白天和投票**：玩家讨论后，超过半数玩家发起投票，所有人各投一票。共犯不能投给自己认为的大盗。
5. **胜负**：得票最多的是大盗时瞌睡鼠获胜；呆呆鸟被投出时呆呆鸟获胜；其他情况大盗阵营获胜。票数相同时按系统统计顺序选出第一名。

夜晚行动和投票需要所有玩家完成；玩家断线后可重新连接继续。奶酪对局全员断线 15 分钟后会过期，公共房间会提示房主重新组局。

## 瞎掰王

房主在大厅选择 3–9 名在线参与者和 1–3 圈，其余成员观战。每圈每人轮流担任一次大聪明；除大聪明外一人为老实人，其余为瞎掰人。玩家按住查看身份，松开后隐藏；本轮查看过一次即可确认准备。大聪明在独立选题页按 1–3 分浏览可用谜面并点选（也可随机选题），所有参与者准备后，只有老实人能在自己的设备上限时查看答案 9 秒。随后大家在线下发言、提问和讨论，大聪明先质疑一人，再指认老实人；平台公布身份、答案和得分。每人初始 3 分，允许负分，同分并列。房主可以提前终止并保留已完成回合的结果。

参与者断线时暂停流程与计时；重连后继续。服务重启后会从 Redis 恢复，意外重启会使用保守的计时检查点，可能损失少量查看时间（正常调度下约 0.5 秒以内）。身份和答案按设备单独发送，观众在揭晓前不可见；匿名凭证保存在设备浏览器中。60 道原创题目及对应参考来源位于 `backend/games/bluff/questions.py`，每题来源也显示在揭晓结果中。已选过或换掉的题本局不重复，单个难度用尽时须选择其他难度。题库只向本轮大聪明发送谜面与提示，不包含答案或来源；其他玩家和观众不会收到题库。

大厅与游戏通过 `/bluff-ws/` 连接，状态保存在 `lobby:game:bluff:room:` 命名空间。规则、持久化与连接分别位于 `backend/games/bluff/engine.py` 和 `service.py`，界面位于 `web/games/bluff.js`。可在隔离测试实例运行 `LOBBY_URL=http://localhost:18089 python scripts/smoke_bluff.py`；脚本会创建测试房间。

## 匿名设备凭证与持久化

大厅签发 HttpOnly Cookie，将凭证哈希与玩家 ID 绑定。大厅写接口和所有游戏 WebSocket 均校验该绑定。昵称、头像及主题偏好保存在当前浏览器；清除 Cookie 会产生新身份。密码使用 scrypt 哈希，公共接口不返回密码、凭证或未公开身份。

Redis 使用 `lobby:` 命名空间，房间及游戏状态由服务端统一管理。始终保持单 worker，不删除已有数据卷。后端重启恢复对局，取消等待室的未完成倒计时。

游戏进行时，平台统一申请原生屏幕常亮锁；切后台、结束游戏或离开房间时释放，返回前台后重试。只有浏览器实际授予常亮锁才报告已开启，可在房间“更多”中查看状态；系统拒绝或释放时显示实际状态。HTTP 已跳转 HTTPS，移除了未能可靠防息屏的视频备用方案。手动锁屏、省电模式或浏览器策略仍可中止常亮。

## 上海 HTTPS 与证书维护

`docker-compose.https.yml` 为正式环境增加 80/443 端口及只读证书挂载；普通 Compose 无证书也可启动。公网 IP 使用 Let's Encrypt 的短期证书，证书与账户位于 `/opt/chesse-acme/letsencrypt`，ACME 校验目录为 `/opt/chesse-acme/webroot`，不进入 Git。80、443 端口需保持开放。

首次签发可在已提供校验目录的 HTTP 入口下执行：

```bash
docker run --rm -v /opt/chesse-acme/letsencrypt:/etc/letsencrypt \
  -v /opt/chesse-acme/webroot:/var/www/certbot certbot/certbot:v5.4.0 \
  certonly --webroot --webroot-path /var/www/certbot --ip-address 111.229.79.183 \
  --preferred-profile shortlived --non-interactive --agree-tos --register-unsafely-without-email
```

`deploy/chesse-certificate.timer` 每天检查两次续期，`deploy/renew-certificate.sh` 成功后校验并重载 Nginx，不中断现有对局。部署时安装到 systemd 并启用：

```bash
cp deploy/chesse-certificate.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now chesse-certificate.timer
systemctl list-timers chesse-certificate.timer
```

续期日志位于 `/opt/chesse-acme/logs`；可用 `journalctl -u chesse-certificate.service` 检查失败。证书有效期约六天，续期定时器必须保持运行。
