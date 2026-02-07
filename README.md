# 🧀 奶酪大盗 - 线上桌游

5-8人社交推理游戏，基于桌游「奶酪大盗」开发的线上版本。

## 技术栈

- **后端**: Python FastAPI + WebSocket
- **前端**: React + Vite + TailwindCSS

## 快速启动

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

访问 http://localhost:3000 开始游戏。

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
