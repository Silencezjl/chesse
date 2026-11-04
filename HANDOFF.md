# 游戏大厅开发交接

统一大厅现已接入奶酪大盗与 Holdem；本文件记录当前运行方式和进一步开发的约束。详细命令见 `README.md`。

- 公共层在 `backend/lobby/`：`rooms.py` 为房间模型，`games.py` 为游戏初始化与切换规则，`runtime.py` 管理游戏快照与连接，`api.py` 提供公共房间 HTTP/WebSocket 接口。`lobby-web/` 是统一大厅，游戏界面在同源 iframe 内运行。
- 奶酪游戏代码保留在 `backend/`、`frontend/`；Holdem 来源及提交见 `games/holdem/UPSTREAM.txt`。两套实时协议独立，公共层管理玩家和游戏选择。
- 公共房间、奶酪和 Holdem 使用 `lobby:room:v1:`、`lobby:game:cheese:`、`lobby:game:holdem:` 等独立 Redis 命名空间；Compose 使用新的 `lobby_redis_data` 卷，不迁移或清除旧游戏数据。
- 已验证五人创建房间、奶酪大盗完整对局、切换 Holdem、入座和结束筹码局；验证了后端重启后的 Holdem 房间/筹码恢复和旧格式 Redis 键保留。`scripts/smoke_lobby.py` 可对隔离开发实例复测。
- 目前单进程运行，锁是进程内锁；不要水平扩容后端。设备 ID 只是匿名标识，未实现账户验证；游戏进行中不接受新成员加入，也不允许离开公共房间。
- 添加游戏时需要实现 `games.py` 的游戏规则接口和 `runtime.py` 的运行时接口，再注册到两个映射，并接入对应界面与网关路由。当前大厅的游戏选择界面和 WebSocket 入口仍针对现有两个游戏配置，接入新游戏时也需扩展它们。
- dify 机器的开发实例使用 Compose 项目 `chesse-integration`，端口 `18088`。此机器 Docker Hub 拉取可能失败，使用 README 中的本机缓存镜像覆盖示例；不要使用 `docker compose down -v`。


## 统一等待室（本轮实现）

- 统一流程由 `backend/lobby/api.py` 的房间锁、显式准备状态和带配置版本的服务端倒计时控制；游戏配置元数据位于 `backend/lobby/catalog.py`。选择游戏只保存配置，倒计时到期才执行 runtime install/begin。
- `stage` 为 choosing/waiting/countdown/playing/finished。游戏私有状态不进入大厅公开响应；前端查看等待室时保留已挂载 iframe，只有会话变化才替换。
- 三个游戏分别适配公共等待室。奶酪大盗开局直接进入夜晚；Holdem 将公共座位映射到牌桌并开始首手；瞎掰王保留选题后每轮查看答案的确认。
- 遇到存储或初始化错误，清理部分会话并返回等待室，清空准备供重试。重启清空准备及倒计时，现有对局由原 runtime 恢复。
- 手机浏览器使用同源 iframe，邀请二维码在本地计算，不向第三方发送房间链接。游戏内的隐藏身份不向观众开放。
- dify 18088 为主要体验实例；18089 的 chesse-bluff-test 仅用于自动重启测试。不得在阿里云正式实例执行这些测试或自动发布。
