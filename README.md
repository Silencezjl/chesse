# 🎲 一起玩 · 游戏大厅

在同一个公共房间中，与朋友游玩奶酪大盗、Holdem 线下筹码管理和瞎掰王。房主在一局结束后切换游戏；切换到 Holdem 会开启新的筹码局。

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

首页先选游戏开房，也可先建空房，再邀请朋友决定玩什么。通过六位房间号、邀请链接或本地生成的二维码加入；HTTP 环境无法使用剪贴板时提供手动复制文本。匿名资料保存在当前设备，无需注册。

- 公共房间最多 12 人，默认按加入顺序入座，超出游戏上限的成员观战。玩家可选择参与或观战，房主可调整参与名单。
- 奶酪大盗支持 5–8 人、瞎掰王支持 3–9 人、Holdem 支持 2–12 人。只有入座玩家需要准备。
- 全员在线且准备后，由服务端执行 3 秒倒计时并自动开局。取消准备、参与者离线会取消倒计时；设置或参与名单变化会让所有人重新准备。新观众不影响倒计时。
- 初次进入游戏不需要再次准备。Holdem 后续每手的准备、补码流程和瞎掰王每轮选题后的查看确认仍在游戏内进行。
- 游戏进行中禁止新成员加入和成员离开，已有成员可刷新重连。结算后房主点击“再来一局 / 换游戏”返回等待室，保留成员和座位并清空准备。结束 Holdem 筹码局后重开会重新发筹码。
- 房主可在等待室转交房主或移出成员；被移出者本房间内不能重新加入。房主离线 60 秒后转交给最早加入的在线成员，进行中的对局延后到结束再处理。
- 同设备多标签页以最新连接为准，旧标签页暂停重连。后端重启保留已有对局，取消尚未完成的开局倒计时并清空准备。
- 首版设备身份不提供账户认证或跨设备身份同步，请勿将房间号及设备 ID 当作强身份验证。大厅不公开枚举房间号和成员资料。

### 公共接口与兼容

`GET /lobby/games` 提供人数、入口和设置描述；`GET /lobby/rooms/{id}/preview` 提供邀请预览，不返回成员身份。房间状态包含 `stage`、`seats`、成员 `ready`、`revision` 和服务端倒计时截止时间。状态通过房间 WebSocket 推送，客户端每 5 秒请求刷新作为对局阶段同步补偿。

`POST /lobby/rooms/{id}/game` 只保存配置，不再直接创建游戏。`/seat` 设置入座状态，`/ready` 使用显式布尔值及配置版本，`/return` 由房主在结算后返回等待室，`/manage?action=transfer|kick` 管理成员。全部准备后由服务端创建唯一会话，客户端无法跳过准备直接开局。

旧房间字段读取时补齐，保留已有对局及 Redis 命名空间。所有 API 和等待室前端需一起发布；旧版大厅脚本不兼容新版准备流程。入口 JS/CSS 使用版本参数及重新验证缓存。Redis 和后端继续使用单 worker，禁止删除已有卷。

## 开发与验证

后端使用 Python/FastAPI，奶酪界面使用 Preact/Vite，Holdem 界面使用 React/TypeScript/Vite，公共大厅和瞎掰王使用独立前端。`backend/lobby/games.py` 定义游戏初始化与切换条件，`backend/lobby/runtime.py` 封装各游戏运行状态与连接管理，`backend/lobby/api.py` 管理公共房间。Holdem 导入来源见 `games/holdem/UPSTREAM.txt`。

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
2. **夜晚**：玩家按骰子点数醒来。独自醒来的瞌睡鼠可以偷看一人的骰子；同时醒来的玩家可以看到彼此。大盗偷走奶酪并选择一名共犯，共犯与大盗同一阵营。
3. **呆呆鸟（可选）**：呆呆鸟和大盗知道彼此身份。呆呆鸟选择一名假共犯，让对方误以为自己是大盗的共犯；若大盗选择同一人，该玩家是真共犯。呆呆鸟和大盗只能互相投票。
4. **白天和投票**：玩家讨论后，超过半数玩家发起投票，所有人各投一票。共犯不能投给自己认为的大盗。
5. **胜负**：得票最多的是大盗时瞌睡鼠获胜；呆呆鸟被投出时呆呆鸟获胜；其他情况大盗阵营获胜。票数相同时按系统统计顺序选出第一名。

夜晚行动和投票需要所有玩家完成；玩家断线后可重新连接继续。奶酪对局全员断线 15 分钟后会过期，公共房间会提示房主重新组局。

## 瞎掰王

房主在大厅选择 3–9 名在线参与者和 1–3 圈，其余成员观战。每圈每人轮流担任一次想想；除想想外一人为老实人，其余为瞎掰人。想想选择 1–3 分的题目，所有参与者准备后，只有老实人能在自己的设备上限时查看答案 9 秒。随后大家在线下发言、提问和讨论，想想先质疑一人，再指认老实人；平台公布身份、答案和得分。每人初始 3 分，允许负分，同分并列。房主可以提前终止并保留已完成回合的结果。

参与者断线时暂停流程与计时；重连后继续。服务重启后会从 Redis 恢复，意外重启会使用保守的计时检查点，可能损失少量查看时间（正常调度下约 0.5 秒以内）。身份和答案按设备单独发送，观众在揭晓前不可见；设备匿名 ID 并非强身份认证。60 道原创题目及对应参考来源位于 `backend/games/bluff/questions.py`，每题来源也显示在揭晓结果中。已抽过或换掉的题本局不重复，单个难度用尽时须选择其他难度。

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
