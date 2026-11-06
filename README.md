# 🎲 一起玩 · 游戏大厅

在同一个公共房间中，与朋友游玩奶酪大盗、Holdem 线下筹码管理和瞎掰王。房主在一局结束后切换游戏；切换到 Holdem 会开启新的筹码局。

## 线上部署

自 2026-11-06 起，正式环境统一部署到上海机器，后续发布使用以下目标。

- SSH 使用 `ssh root@111.229.79.183`。
- 项目目录为 `/opt/chesse`，Compose 项目名为 `chesse-shanghai`。
- 公网入口为 `http://111.229.79.183:8000`。
- 服务器 `.env` 设置 `COMPOSE_PROJECT_NAME=chesse-shanghai` 和 `LOBBY_PORT=8000`。
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

## 开发与验证

后端使用 Python/FastAPI，奶酪界面使用 Preact/Vite，Holdem 界面使用 React/TypeScript/Vite，公共大厅和瞎掰王使用独立前端。大厅和游戏的发送队列限制慢连接对房间操作的影响，奶酪状态按房间合并快照写入。`backend/lobby/games.py` 定义游戏初始化与切换条件，`backend/lobby/runtime.py` 封装各游戏运行状态与连接管理，`backend/lobby/api.py` 管理公共房间。Holdem 导入来源见 `games/holdem/UPSTREAM.txt`。

```bash
conda activate chesse-dev
python -m pip install -r backend/requirements.txt
(cd backend && python -m unittest discover -s tests -v)
(cd frontend && npm ci && npm run build)
(cd games/holdem/frontend && npm ci && npm run build)
LOBBY_URL=http://localhost:8088 python scripts/smoke_lobby.py
```

冒烟脚本会在目标服务上创建临时测试房间，模拟 5 位玩家完成奶酪大盗并切换到 Holdem；请使用独立的开发实例。改动代码后重新执行 `docker compose up -d --build` 以更新容器。当前单独运行原奶酪开发服务器不提供完整大厅；大厅需要 Redis。

## 游戏规则

1. **组局**：5–8 人创建或加入房间，全部准备后开始；房主可选择是否启用呆呆鸟。
2. **夜晚**：玩家按住查看身份卡和骰子，松手后隐藏；本局看过一次后即可进行夜晚行动。玩家按骰子点数醒来。独自醒来的瞌睡鼠可以偷看一人的骰子；同时醒来的玩家可以看到彼此。大盗偷走奶酪并选择一名共犯，共犯与大盗同一阵营。
3. **呆呆鸟（可选）**：呆呆鸟和大盗知道彼此身份。呆呆鸟选择一名假共犯，让对方误以为自己是大盗的共犯；若大盗选择同一人，该玩家是真共犯。呆呆鸟和大盗只能互相投票。
4. **白天和投票**：玩家讨论后，超过半数玩家发起投票，所有人各投一票。共犯不能投给自己认为的大盗。
5. **胜负**：得票最多的是大盗时瞌睡鼠获胜；呆呆鸟被投出时呆呆鸟获胜；其他情况大盗阵营获胜。票数相同时按系统统计顺序选出第一名。

夜晚行动和投票需要所有玩家完成；玩家断线后可重新连接继续。奶酪对局全员断线 15 分钟后会过期，公共房间会提示房主重新组局。

## 瞎掰王

房主在大厅选择 3–9 名在线参与者和 1–3 圈，其余成员观战。每圈每人轮流担任一次大聪明；除大聪明外一人为老实人，其余为瞎掰人。玩家按住查看身份，松开后隐藏；本轮查看过一次即可确认准备。大聪明选择 1–3 分的题目，所有参与者准备后，只有老实人能在自己的设备上限时查看答案 9 秒。随后大家在线下发言、提问和讨论，大聪明先质疑一人，再指认老实人；平台公布身份、答案和得分。每人初始 3 分，允许负分，同分并列。房主可以提前终止并保留已完成回合的结果。

参与者断线时暂停流程与计时；重连后继续。服务重启后会从 Redis 恢复，意外重启会使用保守的计时检查点，可能损失少量查看时间（正常调度下约 0.5 秒以内）。身份和答案按设备单独发送，观众在揭晓前不可见；匿名凭证保存在设备浏览器中。60 道原创题目及对应参考来源位于 `backend/games/bluff/questions.py`，每题来源也显示在揭晓结果中。已抽过或换掉的题本局不重复，单个难度用尽时须选择其他难度。

大厅与游戏通过 `/bluff-ws/` 连接，状态保存在 `lobby:game:bluff:room:` 命名空间。规则、持久化与连接分别位于 `backend/games/bluff/engine.py` 和 `service.py`，界面位于 `bluff-web/`。可在隔离测试实例运行 `LOBBY_URL=http://localhost:18089 python scripts/smoke_bluff.py`；脚本会创建测试房间。

## 新流程验证与回退

```bash
npm ci && npm test
(cd backend && python -m unittest discover -s tests -v)
LOBBY_URL=http://localhost:18088 python scripts/smoke_lobby.py
LOBBY_URL=http://localhost:18088 python scripts/smoke_bluff.py
```

以上脚本只用于 dify 隔离测试实例，成功后移除自身测试房间。重启验证只允许额外的 `chesse-bluff-test` 项目（18089）：

```bash
LOBBY_URL=http://localhost:18089 BLUFF_RESTART_CONTAINER=chesse-bluff-test-backend-1 python scripts/smoke_bluff_restart.py
LOBBY_URL=http://localhost:18089 BLUFF_RESTART_CONTAINER=chesse-bluff-test-backend-1 python scripts/smoke_waiting_restart.py
```

后一个脚本包含真实 60 秒房主转交、倒计时中重启取消和 Holdem 进行中重启恢复，会重启该专用测试后端，不应对正式环境运行。

本轮实施前的本地源码快照保存在本次 Codex 工作目录 `work/chesse-backup/before-platform.tar.gz`。dify 源码备份位于 `/home/zhangjialin/chesse-backups/before-waiting-room.tar.gz`，旧镜像标记为 `chesse-integration-backend:before-waiting-room` 和 `chesse-integration-frontend:before-waiting-room`。回退需停止测试实例、恢复源码并使用旧镜像重新创建前后端；不删除 Redis 卷。新流程产生的等待室数据应继续使用新版管理，回退前先结束测试对局。

## 手机体验验证（2026-11-04）

新增 `backend/tests/test_mobile_lobby.py` 验证房间列表、密码、资料、候场及三款游戏连接权限。`tests/lobby-ui.test.cjs` 覆盖直接入房、密码输入保留、资料复用、候场视图及 iframe 保留。Holdem 支持 `refresh` WebSocket 消息，返回前台先同步再允许操作；游戏与大厅通过同源消息报告连接状态和遮蔽私密信息，不传递身份或答案。

共享手机变量位于 `lobby-web/mobile-tokens.css`，由统一 Nginx 提供 `/mobile-tokens.css`；单独运行游戏开发服务器时不包含完整大厅资源。各游戏入口与后端需一起发布。iOS Safari 和 Android Chrome 的真实设备验收需单独安排，浏览器仿真不等同于真机结果。

可选的手机浏览器自动化需要独立安装 Playwright，并通过环境变量指定模块和 Chromium：

```bash
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chrome \
LOBBY_URL=http://localhost:18088 node scripts/smoke_mobile.cjs
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chrome \
LOBBY_URL=http://localhost:18088 node scripts/smoke_mobile_games.cjs
```

两个脚本仅允许 18088/18089 隔离端口，分别验证房间/密码/设备资料/候场及奶酪、瞎掰王的完整手机操作。截图写入 `/tmp/chesse-*-360.png`；成功后通过正常离房接口清理自身房间。

站点及三款游戏使用统一的插画标识，位于 `lobby-web/assets/`。`*-v1.png` 为透明原图，`*-v1.webp` 为 512px 网页版本（单张约 31–38KB），`party-touch-v1.png` 为手机主屏幕图标。大厅、等待室、游戏选择与标签页均使用图片；用户头像统一使用本地动物 PNG 图片。游戏目录的 `icon` 字段现为同源图片路径。

自动解散的实际后台任务可用以下专用实例冒烟验证：

```bash
LOBBY_URL=http://localhost:18089 python scripts/smoke_empty_rooms.py
```

该脚本仅允许 18089，创建自己的等待室、筹码局和在线保护房间，只回拨自身测试房间的离线时间来验证 15 分钟边界，不修改已有房间或全局过期配置；检查后台清理、成员映射和对局数据后正常移除测试房间。

当前启用的 Logo 与三款游戏图标为 `lobby-web/assets/*-indigo-v1.webp`，与蓝紫界面配色统一；相应透明 PNG 原图及旧版图标均保留。主屏幕图标使用 `party-touch-indigo-v1.png`。

用户头像采用 Kenney Animal Pack Redux（CC0 1.0），30 种不同动物的带描边圆形版本存放在 `lobby-web/assets/avatars/animals-v1/`，来源和授权记录见同目录 `sources.json`、`License.txt`。资料保存 `animal-01` 至 `animal-30` 等短标识；`/avatars.js` 统一解析本地路径，兼容旧 emoji 和 `avatar-01` 至 `avatar-08` 资料，无需修改已有 Redis 数据。选择器使用圆形头像和独立滚动区域，动物名称仅作无障碍标签；图片完整展示耳朵和角，不裁切。大厅、等待室与三款游戏均渲染图片，用户姓名和头像的设备保存逻辑不变。顶部仅保留 Logo，无房间时使用紧凑横向提示。

昵称展示由 `/player-names.js` 和各游戏的 `NameText` 组件统一处理；旧版随机昵称和 #XX 尾号兼容显示为纯名字，输入框恢复 12 字符额度。加入房间或修改昵称时，服务端按显示名字在房间锁内检查重名；已有成员重连不受影响。跨房间允许同名，身份始终由设备 UID 识别。

等待室直接展示所选游戏的完整规则与当前设置，规则随游戏切换。奶酪大盗说明恢复原入口的夜晚、共犯、投票、胜负与呆呆鸟规则；瞎掰王包含身份、选题、讨论、质疑/指认计分，Holdem 包含线下发牌、行动与筹码结算。规则文本位于 `backend/lobby/rules.py`，通过游戏目录提供，弹层复用同一内容。加入时昵称冲突会自动尝试新的随机昵称并提示，沿用当前设备 UID，无需再次填写资料。

大厅顶部和游戏外层工具栏显示客户端到服务器的往返延迟（RTT，ms），每 5 秒测量。首页使用不缓存的 `GET /lobby/ping`；入房后使用公共房间 WebSocket 的 `ping/pong`，通过请求 ID 配对。低于 100ms 为绿色，100–299ms 为黄色，300ms 及以上为红色；尚未测量、超时、断线、后台暂停分别展示状态文字，不保留旧数值。延迟更新只更新标签，不重建游戏 iframe 或正在编辑的资料表单。
切后台只暂停测速，仍保留原有的 15 秒房间心跳。

顶部四角按钮支持进入/退出浏览器原生全屏，向支持的浏览器请求隐藏导航栏；目标是稳定的根文档，房间状态刷新、规则切换及游戏 iframe 更新不会主动退出全屏。必须由用户点击触发；刷新、系统手势或浏览器切换可能退出，不自动抢占屏幕。支持能力通过 API 检测，不支持时展示说明。全屏 API 不能保证所有手机系统行为；Android Chrome 的实体设备验收仍需实际测试，iPhone 浏览器支持随系统而异。实现参考 [MDN requestFullscreen](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen)。

全屏滚动按内容分配：短大厅页不再预留固定 140px，等待室只为操作栏实测高度和 16px 间距留位；游戏外层不滚动，长规则、历史和游戏内长名单仍可阅读。资料弹层锁定背景，头像列表独立滚动。Holdem 多人结算在面板内滚动，底部返回按钮可达。

新增滚动回归脚本（Node.js 22+ 和独立 Playwright；仅隔离端口 18088/18089，会创建并清理自己的 12 人房间）：

```bash
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chrome \
LOBBY_URL=http://localhost:18088 node scripts/smoke_scroll.cjs
```

右上角快捷控件采用统一圆角容器：信号图标与延迟数字、全屏按钮、圆形动物头像。头像不显示可见昵称，仍通过无障碍标签保留资料说明，点击继续编辑昵称和头像；触控按钮至少 44px。

## 匿名设备凭证

大厅首次访问时签发随机 Cookie，并在 Redis 保存凭证哈希与玩家 ID 的绑定。大厅写接口和三个游戏的 WebSocket 均校验该绑定。清除 Cookie 或更换浏览器后生成新身份，昵称和头像仍使用浏览器本地资料。旧版设备 ID 无法认领已有房间。凭证有效期为一年，访问大厅时续期。生产环境应通过 HTTPS 提供服务。

大厅列表短时共享缓存并在房间变化时失效，客户端请求房间刷新时仅回复发起者。容器日志按 10 MiB 轮转并保留三份，后端健康检查同时验证 Redis 连接。

手机上的创建房间、等待室准备、身份查看和主要游戏操作集中在底部操作栏，并为安全区及长内容预留空间。奶酪大盗与瞎掰王的身份信息按住时显示在屏幕中部，松开即隐藏；德州扑克下注及首手准备同样位于底部。具体玩家目标仍在对应名单中选择。
