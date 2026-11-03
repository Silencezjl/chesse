# 🧀 奶酪大盗 - 线上桌游

5-8人社交推理游戏，基于桌游「奶酪大盗」开发的线上版本。

## 技术栈

- **后端**: Python FastAPI + WebSocket + uvloop
- **前端**: Preact + Vite + TailwindCSS
- **数据**: Redis 7 (状态持久化 + 崩溃恢复)
- **部署**: Docker Compose

## Docker 部署（推荐）

### 一键启动

```bash
docker compose up -d --build
```

服务启动后访问 `http://localhost` 开始游戏。

包含三个容器：
- **cheese-frontend** — 前端服务，端口 80
- **cheese-backend** — FastAPI 游戏服务
- **cheese-redis** — Redis 持久化存储

### 停止服务

```bash
docker compose down
```

### 查看日志

```bash
docker compose logs -f cheese-backend
```

### 重新构建（代码更新后）

```bash
docker compose up -d --build
```

> Redis 数据保存在 Docker Volume `chesse_redis_data` 中，`docker compose down` 不会删除数据。如需清除数据：`docker compose down -v`

## 本地开发

### 1. 安装后端依赖
```bash
cd backend
pip install -r requirements.txt
```

### 2. 安装前端依赖
```bash
cd frontend
npm install
```

### 3. 启动后端
```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. 启动前端（开发模式）
```bash
cd frontend
npm run dev
```

本地开发模式下 Redis 为可选，未连接时自动降级为纯内存模式。

## 游戏规则

1. **组局**：5–8 人创建或加入房间，全部准备后开始；房主可选择是否启用呆呆鸟。
2. **夜晚**：玩家按骰子点数醒来。独自醒来的瞌睡鼠可以偷看一人的骰子；同时醒来的玩家可以看到彼此。大盗偷走奶酪并选择一名共犯，共犯与大盗同一阵营。
3. **呆呆鸟（可选）**：呆呆鸟和大盗知道彼此身份。呆呆鸟选择一名假共犯，让对方误以为自己是大盗的共犯；若大盗选择同一人，该玩家是真共犯。呆呆鸟和大盗只能互相投票。
4. **白天和投票**：玩家讨论后，超过半数玩家发起投票，所有人各投一票。共犯不能投给自己认为的大盗。
5. **胜负**：得票最多的是大盗时瞌睡鼠获胜；呆呆鸟被投出时呆呆鸟获胜；其他情况大盗阵营获胜。票数相同时按系统统计顺序选出第一名。

夜晚行动和投票需要所有玩家完成；玩家断线后可重新连接继续。全员断线的房间保留 15 分钟。
