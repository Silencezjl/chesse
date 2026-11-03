# Holdem 上游代码

- 来源及导入版本见 `UPSTREAM.txt`。
- 后端代码位于本仓库 `backend/games/holdem/`；前端代码位于 `games/holdem/frontend/`。
- 本次导入已移除启动清空房间行为，并将 Redis 键隔离到 `lobby:game:holdem:` 命名空间。
- 大厅接入、同源路由和统一部署尚未完成，此目录中的前端尚不是最终入口。
