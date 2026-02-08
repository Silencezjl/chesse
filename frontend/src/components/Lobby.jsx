import React, { useState, useEffect } from 'react';
import { Plus, LogIn, Shuffle, ChevronRight, Eye, EyeOff, RefreshCw, Users } from 'lucide-react';

const AVATARS = [
  "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯",
  "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦",
  "🐱", "🐶", "🐺", "🦝", "🦄", "🐲", "🦉", "🦅",
  "🐿️", "🦔", "🐾", "🐳", "🐬", "🦈", "🐙", "🦑",
  "🦋", "🐞", "🐝", "🦎", "🐢", "🐍", "🦩", "🦜",
  "🐏", "🦌", "🐘", "🦒", "🦘", "🐊", "🦀", "🐡",
];

const NAMES = [
  "小白", "大黄", "阿花", "豆豆", "球球", "旺财", "小黑", "毛毛",
  "咪咪", "点点", "糖糖", "乐乐", "欢欢", "妞妞", "贝贝", "多多",
  "团团", "圆圆", "丁丁", "当当", "奇奇", "妙妙", "嘟嘟", "泡泡",
  "花花", "果果", "米粒", "芝麻", "年糕", "汤圆", "饺子", "包子",
  "薯条", "可乐", "奶茶", "布丁", "麻团", "芋头", "栗子", "核桃",
  "小鱼", "虾米", "螃蟹", "海星", "云朵", "星星", "月亮", "太阳",
];

export default function Lobby({ ws }) {
  const [mode, setMode] = useState(null); // null | 'create' | 'join'
  const [name, setName] = useState(() => NAMES[Math.floor(Math.random() * NAMES.length)] + Math.floor(Math.random() * 99));
  const [avatar, setAvatar] = useState(() => AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  const [showAllAvatars, setShowAllAvatars] = useState(false);
  const [showNamePicker, setShowNamePicker] = useState(false);
  const [thiefSeeAllDice, setThiefSeeAllDice] = useState(true);
  const [maxDice, setMaxDice] = useState(6);
  const [outsiderRatatouille, setOutsiderRatatouille] = useState(false);
  const [outsiderTrickster, setOutsiderTrickster] = useState(false);
  const [outsiderDrunk, setOutsiderDrunk] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const randomize = () => {
    setName(NAMES[Math.floor(Math.random() * NAMES.length)] + Math.floor(Math.random() * 99));
    setAvatar(AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  };

  const handleCreate = () => {
    ws.send('create_room', {
      name, avatar,
      thief_see_all_dice: thiefSeeAllDice,
      max_dice: maxDice,
      outsider_ratatouille: outsiderRatatouille,
      outsider_trickster: outsiderTrickster,
      outsider_drunk: outsiderDrunk,
    });
  };

  const handleJoinRoom = (roomId) => {
    ws.send('join_room', { room_id: roomId, name, avatar });
  };

  const refreshRoomList = () => {
    setRefreshing(true);
    ws.send('list_rooms', {});
    setTimeout(() => setRefreshing(false), 500);
  };

  // Fetch room list when entering join mode
  useEffect(() => {
    if (mode === 'join') {
      ws.send('list_rooms', {});
    }
  }, [mode, ws]);

  if (!mode) {
    return (
      <div className="w-full max-w-md mt-8 md:mt-16 animate-fade-in">
        <div className="glass-card p-8 text-center">
          <div className="text-6xl mb-4">🧀</div>
          <h2 className="text-xl font-bold mb-2">欢迎来到奶酪大盗</h2>
          <p className="text-white/50 text-sm mb-8">5-8人社交推理桌游</p>

          <div className="space-y-4">
            <button
              onClick={() => setMode('create')}
              className="btn-primary w-full flex items-center justify-center gap-2 text-lg"
            >
              <Plus size={20} />
              创建房间
            </button>
            <button
              onClick={() => setMode('join')}
              className="btn-secondary w-full flex items-center justify-center gap-2 text-lg"
            >
              <LogIn size={20} />
              加入房间
            </button>
          </div>

          <div className="mt-8 text-xs text-white/30 space-y-1">
            <p>🐭 瞌睡鼠：找出谁偷了奶酪</p>
            <p>🧀 奶酪大盗：隐藏身份蒙混过关</p>
          </div>
        </div>

        <div className="glass-card p-6 mt-4 text-left">
          <h3 className="text-sm font-bold text-cheese-400 mb-3">📜 游戏规则</h3>
          <div className="text-xs text-white/50 space-y-3 leading-relaxed">
            <div>
              <p className="font-medium text-white/70 mb-1">🌙 1. 夜晚阶段</p>
              <p>天黑请闭眼，按骰子点数顺序，对应点数的玩家睁眼并行动。</p>
              <ul className="list-disc list-inside mt-1 space-y-0.5 text-white/40">
                <li>如果一个瞌睡鼠独自醒来（大盗不行），可以秘密地查看任意一名玩家的骰子。</li>
                <li>如果不止一个人醒来，则不能查看骰子，但可以相互监视。</li>
                <li>无论多少人同时睁眼，大盗醒来都一定要偷走奶酪（即使被监视）。</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-white/70 mb-1">🤝 2. 选择共犯</p>
              <p>大盗在最后会选择一名共犯，与大盗同赢同输。</p>
            </div>
            <div>
              <p className="font-medium text-white/70 mb-1">☀️ 3. 白天讨论</p>
              <p>所有玩家完成操作后，公开讨论，投票指认奶酪大盗。</p>
            </div>
            <div>
              <p className="font-medium text-white/70 mb-1">🗳️ 4. 投票结果</p>
              <p>如果大盗得票最多，大盗失败；否则大盗成功逃脱！</p>
            </div>
            <div className="border-t border-white/10 pt-3 mt-3">
              <p className="font-medium text-white/70 mb-2">🌟 外来者角色（可选）</p>
              <p className="mb-2">开启后每局随机出现一个外来者身份（可能是大盗），增加游戏随机性和趣味性。（酒鬼鼠一定是瞌睡鼠阵营，其余外来着可能被选做“共犯”）</p>
              <ul className="list-disc list-inside space-y-1 text-white/40">
                <li><span className="text-white/60">🍳 料理鼠王</span>：技能是黑暗料理；开局随机迷惑一名玩家（不是自己，可能是大盗），被迷惑者会在错误的时间点醒来。料理鼠王只知道自己的身份，不知道迷惑了谁。</li>
                <li><span className="text-white/60">🧸 鼠小弟</span>：技能是捣蛋；开局随机交换两人的骰子（可能是自己），被换者以为自己是原来的点数醒来。鼠小弟只知道自己的身份，不知道调换了谁。</li>
                <li><span className="text-white/60">🍺 酒鬼鼠</span>：技能是醉酒；一定是瞌睡鼠阵营，但以为自己是大盗，全程闭眼睡觉做梦。也会选“共犯”，只有真大盗也选了酒鬼鼠时，酒鬼鼠选的共犯才会生效。🤝但：如果大盗和酒鬼鼠互相选择对方作为共犯，则本局没有共犯，大盗单独行动。</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mt-8 md:mt-16 animate-fade-in">
      <div className="glass-card p-8">
        <button
          onClick={() => setMode(null)}
          className="text-white/50 hover:text-white text-sm mb-6 flex items-center gap-1"
        >
          ← 返回
        </button>

        <h2 className="text-xl font-bold mb-6">
          {mode === 'create' ? '创建房间' : '加入房间'}
        </h2>

        {/* Profile Setup */}
        <div className="mb-6">
          <label className="text-sm text-white/60 mb-2 block">你的形象</label>
          <div className="flex items-center gap-4">
            <div className="text-5xl cursor-pointer hover:scale-110 transition-transform"
              onClick={() => setAvatar(AVATARS[Math.floor(Math.random() * AVATARS.length)])}>
              {avatar}
            </div>
            <div className="flex-1">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field mb-2"
                placeholder="输入昵称"
                maxLength={12}
              />
              <div className="flex items-center gap-3">
                <button onClick={randomize} className="text-xs text-cheese-400 hover:text-cheese-300 flex items-center gap-1">
                  <Shuffle size={12} /> 随机生成
                </button>
                <button onClick={() => setShowNamePicker(!showNamePicker)} className="text-xs text-white/40 hover:text-white/70">
                  {showNamePicker ? '收起昵称' : '选择昵称'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Name Picker */}
        {showNamePicker && (
          <div className="mb-6">
            <label className="text-sm text-white/60 mb-2 block">点击选择昵称</label>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 bg-white/5 rounded-lg">
              {NAMES.map((n) => (
                <button
                  key={n}
                  onClick={() => setName(n + Math.floor(Math.random() * 99))}
                  className="text-xs px-2.5 py-1 rounded-full bg-white/10 hover:bg-cheese-500/30 hover:text-cheese-300 transition-all"
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Avatar Grid */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-white/60">选择头像</label>
            <button
              onClick={() => setShowAllAvatars(!showAllAvatars)}
              className="text-xs text-white/40 hover:text-white/70"
            >
              {showAllAvatars ? '收起' : `全部 (${AVATARS.length})`}
            </button>
          </div>
          <div className={`grid grid-cols-8 gap-2 ${showAllAvatars ? 'max-h-48 overflow-y-auto p-1' : ''}`}>
            {(showAllAvatars ? AVATARS : AVATARS.slice(0, 16)).map((a) => (
              <button
                key={a}
                onClick={() => setAvatar(a)}
                className={`text-2xl p-1.5 rounded-lg transition-all ${
                  avatar === a ? 'bg-cheese-500/30 scale-110 ring-2 ring-cheese-400' : 'hover:bg-white/10'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {/* Room Settings (create mode only) */}
        {mode === 'create' && (
          <div className="mb-6">
            <label className="text-sm text-white/60 mb-3 block">房间设置</label>
            <div className="space-y-3">
              <div
                onClick={() => setThiefSeeAllDice(!thiefSeeAllDice)}
                className="flex items-center justify-between p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition"
              >
                <div className="flex items-center gap-2">
                  {thiefSeeAllDice ? <Eye size={16} className="text-cheese-400" /> : <EyeOff size={16} className="text-white/40" />}
                  <div>
                    <div className="text-sm font-medium">大盗可见所有点数</div>
                    <div className="text-xs text-white/40">
                      {thiefSeeAllDice ? '大盗能看到所有骰子点数' : '大盗无法看到其他人的骰子点数'}
                    </div>
                  </div>
                </div>
                <div className={`w-10 h-6 rounded-full transition-colors relative ${
                  thiefSeeAllDice ? 'bg-cheese-500' : 'bg-white/20'
                }`}>
                  <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    thiefSeeAllDice ? 'translate-x-4.5 left-0.5' : 'left-0.5'
                  }`} style={{ transform: thiefSeeAllDice ? 'translateX(18px)' : 'translateX(0)' }} />
                </div>
              </div>

              {/* Max Dice Setting */}
              <div className="p-3 bg-white/5 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-cheese-400">🎲</span>
                    <div>
                      <div className="text-sm font-medium">骰子面数</div>
                      <div className="text-xs text-white/40">
                        醒来点数范围 1~{maxDice}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {[6, 7, 8, 9, 10].map((v) => (
                      <button
                        key={v}
                        onClick={() => setMaxDice(v)}
                        className={`w-8 h-8 rounded-lg text-sm font-bold transition-all ${
                          maxDice === v
                            ? 'bg-cheese-500 text-night-900'
                            : 'bg-white/10 text-white/60 hover:bg-white/20'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Outsider Settings */}
              <div className="p-3 bg-white/5 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-cheese-400">🌟</span>
                  <div>
                    <div className="text-sm font-medium">外来者角色</div>
                    <div className="text-xs text-white/40">开启后每局随机出现一个外来者</div>
                  </div>
                </div>
                <div className="space-y-2">
                  {[
                    { key: 'ratatouille', label: '🍳 料理鼠王', desc: '黑暗料理迷惑一人，使其在错误时间醒来', value: outsiderRatatouille, setter: setOutsiderRatatouille },
                    { key: 'trickster', label: '🧸 鼠小弟', desc: '随机交换两人骰子，被换者不知情', value: outsiderTrickster, setter: setOutsiderTrickster },
                    { key: 'drunk', label: '🍺 酒鬼鼠', desc: '以为自己是大盗，实际是老鼠', value: outsiderDrunk, setter: setOutsiderDrunk },
                  ].map((o) => (
                    <div
                      key={o.key}
                      onClick={() => o.setter(!o.value)}
                      className="flex items-center justify-between p-2 rounded-lg cursor-pointer hover:bg-white/5 transition"
                    >
                      <div>
                        <div className="text-xs font-medium">{o.label}</div>
                        <div className="text-xs text-white/30">{o.desc}</div>
                      </div>
                      <div className={`w-9 h-5 rounded-full transition-colors relative ${
                        o.value ? 'bg-cheese-500' : 'bg-white/20'
                      }`}>
                        <div className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
                          style={{ transform: o.value ? 'translateX(16px)' : 'translateX(2px)' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {mode === 'join' && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm text-white/60">在线房间</label>
              <button
                onClick={refreshRoomList}
                className="text-xs text-white/40 hover:text-white/70 flex items-center gap-1"
              >
                <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> 刷新
              </button>
            </div>
            {ws.roomList.length === 0 ? (
              <div className="text-center py-8 text-white/30">
                <Users size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">暂无可加入的房间</p>
                <p className="text-xs mt-1">试试创建一个新房间吧！</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {ws.roomList.map((room) => (
                  <div
                    key={room.room_id}
                    className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition"
                  >
                    <div>
                      <div className="text-sm font-medium">{room.creator_name} 的房间</div>
                      <div className="text-xs text-white/40 flex items-center gap-2 mt-0.5">
                        <span><Users size={10} className="inline" /> {room.connected_count}/{room.max_players} 在线</span>
                        <span>🎲 {room.max_dice}面</span>
                        <span>{room.thief_see_all_dice ? '👁 大盗可见点数' : '🙈 大盗不可见点数'}</span>
                        {room.outsiders && room.outsiders.length > 0 && (
                          <span>🌟 {room.outsiders.map(o => o === 'ratatouille' ? '🍳' : o === 'trickster' ? '🧸' : '🍺').join('')}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleJoinRoom(room.room_id)}
                      className="text-xs px-3 py-1.5 bg-cheese-500/80 hover:bg-cheese-500 text-white rounded-lg transition flex items-center gap-1"
                    >
                      <LogIn size={12} /> 加入
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === 'create' && (
          <button
            onClick={handleCreate}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            创建并进入
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
