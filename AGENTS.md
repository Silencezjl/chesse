# 项目与开发环境

开始开发前阅读 `README.md` 和 `HANDOFF.md`。本项目是统一游戏大厅，包含奶酪大盗和 Holdem 线下筹码管理。

- `backend/lobby/` 管理公共房间、游戏注册与运行时；`backend/` 是 FastAPI 入口和奶酪规则，`backend/games/holdem/` 是 Holdem 后端。
- `lobby-web/` 是大厅入口；`web/platform/` 管理游戏生命周期和全平台主题；`web/games/` 是三个原生游戏模块，统一使用根目录 Vite 构建，React 游戏共用同一运行库。Nginx 提供统一 HTTP/WebSocket 入口。
- Redis 是公共大厅与 Holdem 必需的；各模块使用 `lobby:` 前缀隔离存储。不得清空或覆盖旧项目 Redis 数据，禁止对现有 volume 执行删除操作。当前后端只支持单 worker。

## 启动

完整大厅使用 Docker Compose：

```bash
docker compose up -d --build
```

默认访问 `http://localhost:8088`。`dify` 开发机的隔离实例使用项目名 `chesse-integration` 和端口 18088，项目本地 `.env` 指定本机缓存镜像；使用 `docker compose -p chesse-integration up -d --build`。其他环境和配置项见 `README.md`。前端统一由根目录 Vite 构建，游戏没有独立 Vite 服务。

## 验证

使用 Python 3.11（本地已有 `chesse-dev` Conda 环境）及 Node.js：

```bash
(cd backend && python -m unittest discover -s tests -v)
npm ci && npm run build && npm run typecheck
LOBBY_URL=http://localhost:8088 python scripts/smoke_lobby.py
```

冒烟脚本会创建测试房间，应针对隔离开发实例运行。涉及规则、重连或存储的改动还应模拟多人 WebSocket 对局及重启恢复。

用户要求修改验证后直接发布上海线上，不再启动隔离体验环境。多人测试脚本不得直接指向线上；前端回归使用 `scripts/smoke_platform.cjs` 的构建产物与协议模拟。已有数据卷继续保留。
