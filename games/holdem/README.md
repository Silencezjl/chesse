# Holdem 筹码管理

上游来源及导入版本见 `UPSTREAM.txt`。后端位于 `backend/games/holdem/`，前端位于 `games/holdem/frontend/`。游戏通过统一大厅创建房间、管理成员和开局，通过 `/holdem-ws/` 交换对局消息，Redis 键使用 `lobby:game:holdem:` 前缀。

完整启动和验证方式见仓库根目录 `README.md`。
