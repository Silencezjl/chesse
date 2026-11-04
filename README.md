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

- 使用设备上的匿名昵称、头像和身份创建或加入公共房间。房间最多 12 人，房主可选择游戏及本局设置。
- 奶酪大盗由房主选择 5–8 名在线玩家参与，其他房间成员观战；所有参与者准备后开始。
- 瞎掰王由房主选择 3–9 名在线玩家参与，其余成员观战；详见下方规则。
- Holdem 支持 12 个座位，并由房主结束筹码局。切离后再次进入时按新设置重新发筹码。
- 游戏进行时不能切换游戏或离开公共房间。奶酪大盗结算、Holdem 筹码局或瞎掰王结束后可回到房间切换；游戏进行时新玩家暂不能加入。
- 同一房间实时同步成员和游戏选择，刷新或服务重启后可用原设备重连。首版设备身份不提供账户认证或跨设备身份同步，请勿将房间号及设备 ID 当作强身份验证。

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

夜晚行动和投票需要所有玩家完成；玩家断线后可重新连接继续。全员断线的房间保留 15 分钟。

## 瞎掰王

房主在大厅选择 3–9 名在线参与者和 1–3 圈，其余成员观战。每圈每人轮流担任一次想想；除想想外一人为老实人，其余为瞎掰人。想想选择 1–3 分的题目，所有参与者准备后，只有老实人能在自己的设备上限时查看答案 9 秒。随后大家在线下发言、提问和讨论，想想先质疑一人，再指认老实人；平台公布身份、答案和得分。每人初始 3 分，允许负分，同分并列。房主可以提前终止并保留已完成回合的结果。

参与者断线时暂停流程与计时；重连后继续。服务重启后会从 Redis 恢复，意外重启会使用保守的计时检查点，可能损失少量查看时间（正常调度下约 0.5 秒以内）。身份和答案按设备单独发送，观众在揭晓前不可见；设备匿名 ID 并非强身份认证。60 道原创题目及对应参考来源位于 `backend/games/bluff/questions.py`，每题来源也显示在揭晓结果中。已抽过或换掉的题本局不重复，单个难度用尽时须选择其他难度。

大厅与游戏通过 `/bluff-ws/` 连接，状态保存在 `lobby:game:bluff:room:` 命名空间。规则、持久化与连接分别位于 `backend/games/bluff/engine.py` 和 `service.py`，界面位于 `bluff-web/`。可在隔离测试实例运行 `LOBBY_URL=http://localhost:18089 python scripts/smoke_bluff.py`；脚本会创建测试房间。
