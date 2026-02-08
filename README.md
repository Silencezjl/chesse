# 🧀 奶酪大盗 - 线上桌游

5-8人社交推理游戏，基于桌游「奶酪大盗」开发的线上版本。

## 技术栈

- **后端**: Python FastAPI + WebSocket + uvloop
- **前端**: React + Vite + TailwindCSS
- **数据**: Redis 7 (状态持久化 + 崩溃恢复)
- **部署**: Docker Compose

## Docker 部署（推荐）

### 一键启动

```bash
docker compose up -d --build
```

服务启动后访问 `http://localhost:8000` 开始游戏。

包含两个容器：
- **cheese-thief** — 游戏服务（FastAPI + 前端静态文件），端口 8000
- **cheese-redis** — Redis 持久化存储

### 停止服务

```bash
docker compose down
```

### 查看日志

```bash
docker compose logs -f cheese-thief
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

1. **创建/加入房间**: 创建房间获取6位房间号，分享给朋友加入
2. **准备阶段**: 所有人准备后自动开始游戏
3. **夜晚阶段**: 
   - 奶酪大盗自动偷走奶酪，可查看所有人骰子
   - 瞌睡鼠可偷看一位玩家的骰子
   - 6人以上局大盗可选择共犯
4. **白天阶段**: 讨论谁是大盗
5. **投票阶段**: 投出嫌疑最大的玩家
6. **胜负**: 投中大盗则瞌睡鼠赢，否则大盗赢
