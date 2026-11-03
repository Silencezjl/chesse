# 项目与开发环境

> 游戏大厅合并进行中：开始开发前先阅读 `HANDOFF.md`，其中记录了已完成内容、未接通的功能和部署注意事项。

- 本项目是「奶酪大盗」多人社交推理游戏。后端在 `backend/`，使用 Python、FastAPI 和 WebSocket；游戏规则、房间状态及序列化分别分布在 `game.py`、`room_state.py`、`night_actions.py`、`voting.py`、`serialization.py` 等文件中。
- 前端在 `frontend/`，使用 Preact（通过兼容别名支持 React 导入）、Vite 和 Tailwind CSS。`src/hooks/useWebSocket.js` 管理与后端的连接，`src/components/` 包含游戏界面。
- Redis 用于状态快照与恢复，默认地址是 `redis://localhost:6379/0`，可通过 `REDIS_URL` 覆盖。Redis 不可用时后端自动使用内存模式，重启后状态不会保留。

## 本地开发

现有 Conda 环境名为 `chesse-dev`，已验证 Python 3.11；前端已验证 Node.js 24。依赖清单分别为 `backend/requirements.txt` 和 `frontend/package-lock.json`。若环境尚不存在，可执行：

```bash
conda create -n chesse-dev python=3.11
conda activate chesse-dev
python -m pip install -r backend/requirements.txt
cd frontend && npm ci
```

在两个终端中分别启动（先确认端口未被现有服务占用）：

```bash
conda activate chesse-dev
cd backend
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

访问 http://localhost:3000，后端 API 文档为 http://localhost:8000/docs。Vite 将 `/ws` 代理到后端 8000 端口。开发服务器在各自终端中用 Ctrl+C 停止。

## 验证

- 后端依赖检查：`conda run -n chesse-dev python -m pip check`。
- 前端构建：`cd frontend && npm run build`。
- 后端测试：`cd backend && python -m unittest discover -s tests -v`（使用 `chesse-dev` 环境）；涉及游戏流程的修改应额外进行多人房间和 WebSocket 的实际验证。
- Docker Compose 部署方式见 `README.md`；本地开发不需要 Docker 或 Redis。
