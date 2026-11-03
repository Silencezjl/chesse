# 游戏大厅合并：开发交接

## 当前状态

**大厅尚未完成，不能作为统一大厅使用。** 当前默认启动的仍是原来的奶酪大盗；Holdem 已导入，但没有接入主应用、公共房间、网关或 Compose。请不要将当前分支理解为可上线的合并版本。

原始目标：将奶酪大盗与线下德扑筹码管理项目整合到一个可继续添加游戏的大厅，统一网址、匿名玩家资料与公共房间，同一房间可由房主在本局结束后切换游戏。

## 已确认的产品规则

- 公共房间最多 12 人；奶酪大盗由房主选择 5–8 名在线成员参与，其他成员观战。Holdem 沿用最多 12 个座位。
- 仅在奶酪大盗进入结算或 Holdem 筹码局结束后允许切换；回到 Holdem 时新开筹码局，按设置重新发筹码。
- 一个仓库、一套 Compose、一个网站；首版使用设备级匿名身份，不做账户、支付或跨设备身份。
- 新系统全新开始，不迁移旧房间和筹码；**保留旧 Redis 数据，禁止清空或覆盖旧数据**。

## 已完成

- 上游 Holdem 来源及实际导入提交见 `games/holdem/UPSTREAM.txt`，提交为 `84decc288b61b3dc25b4a95afff23947b40977f9`。
- Holdem 后端源码在 `backend/games/holdem/`；React/TypeScript 前端及其素材在 `games/holdem/frontend/`。原奶酪后端和 Preact 前端仍分别在 `backend/`、`frontend/`。
- 移除 Holdem 原来在启动时清空房间的行为，Holdem Redis 键改为 `lobby:game:holdem:room:<id>` 和 `lobby:game:holdem:rooms`。
- `backend/lobby/rooms.py` 提供了**尚未接入服务**的公共房间内存模型；`backend/lobby/games.py` 有游戏初始化及切换检查适配器。它们目前是基础代码，不是完整插件接口。
- `backend/tests/test_lobby.py` 覆盖人数上限、房主权限、奶酪参与者选择、切换检查、筹码初始化和无效操作的状态不变性。
- 在原机器上，后端 13 项单元测试通过，两套前端分别构建成功；没有运行 Redis、Docker Compose 或合并后的多人端到端测试。

## 关键缺口与建议实施顺序

1. **建立公共房间服务和持久化。** 定义创建、加入、离开、查询、房主转移、重连和实时订阅接口；公共层作为成员与房主的唯一权威来源，持久化到独立 Redis 命名空间，处理并发更新与重启恢复。当前 `LobbyRoom` 仅是内存对象，`restore()` 也只是复制快照；没有 API、WebSocket、锁或 Redis 存储。`new_id()` 还需在持久层检查冲突。游戏进行中加入与离开、断线、无在线玩家的处理也要明确并实现。
2. **完成游戏模块边界。** 将两套现有游戏的实际操作、成员/连接变化、状态快照与恢复接入公共房间；现在适配器仅实现 `create` 和 `can_switch`。不能只检查创建时快照：实时游戏状态必须可靠回写，再基于最新状态决定切换。限制游戏私有入口绕过公共成员/房主权限，并避免玩家私人信息通过公共房间事件泄露。
3. **对接两套现有界面。** 建立大厅 UI 和清晰路由，统一本地设备 ID、昵称和头像。奶酪使用 `/ws/{player_id}`、独立的本地资料与房间状态；Holdem 使用 `/api/...`、`/ws/{room_id}/{player_id}`、另一套本地存储和独立 React Router。需要适配入口、房间成员、返回大厅与断线重连，而非简单拼接首页。Holdem 的卡牌、筹码图片使用根路径，部署到子路径时也要处理静态资源和 SPA 路由。
4. **统一部署。** 修改根目录 Dockerfile、`docker-compose.yml`、`nginx.conf` 及开发代理，让一个同源入口提供大厅、两套前端、各游戏 HTTP/WebSocket 和 Redis。当前根 Compose **只启动奶酪大盗**，不会启动大厅或 Holdem；Holdem 前端目录内的 Dockerfile/nginx 配置是上游遗留，尚未适配统一部署。
5. **真实联调。** 在隔离的 Redis 数据库/实例中，验证公共房间从奶酪大盗完整对局切至 Holdem、入座下注和结算，再次进入 Holdem 时筹码重置；验证多个玩家、观众、12 人上限、房主迁移、并发、刷新、重复连接、断线及服务重启恢复。先预置旧格式 Redis 键，确认启动和操作均不修改或删除它们。

## 新机器快速开始与检查

```bash
git clone git@github.com:Silencezjl/chesse.git
cd chesse
```

现有 Docker 基线（**仅奶酪大盗，不是新大厅**；服务映射宿主机 80 端口）：

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f cheese-backend
```

现有 Compose 使用具名 Redis volume。停止时使用 `docker compose down`；不要使用 `down -v`、Redis `FLUSH*` 等会删除数据的命令。仓库镜像地址使用 Daocloud 镜像，若新机器无法访问，需要按环境调整镜像源。

可独立复现现有单元测试及构建（需要 Python 3.11 和 Node.js）：

```bash
conda create -n chesse-dev python=3.11
conda activate chesse-dev
python -m pip install -r backend/requirements.txt
(cd backend && python -m unittest discover -s tests -v)
(cd frontend && npm ci && npm run build)
(cd games/holdem/frontend && npm ci && npm run build)
```

Holdem 上游使用 FastAPI、Redis、React/TypeScript、Vite；其前端构建通过不代表后端已经挂载或可从大厅访问。安装依赖会按项目锁文件生成本地 `node_modules`，构建产物和依赖不应提交。
