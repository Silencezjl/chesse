import React, { useState, useEffect } from 'react';
import {
  Copy, LogOut, Check, Eye, Vote, Users, Settings, Crown,
  RotateCcw, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, UserPlus, Hand
} from 'lucide-react';

const DICE_ICONS = [null, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6];

function DiceIcon({ value, size = 20 }) {
  const Icon = DICE_ICONS[value];
  return Icon ? <Icon size={size} /> : <span>{value}</span>;
}

function PlayerCard({ player, index, isMe, isCreator, isMeThief, isMeTom, phase, onPeek, onVote, onAccomplice, onDodobirdAccomplice, onAssassinate, myVote, canAccomplice, canDodobirdAccomplice, canAssassinate, noVoteTarget, voteOnlyTarget, excludeAccomplice, excludeDodobirdAccomplice }) {
  const OUTSIDER_LABELS = {
    drunk: '🍺 酒鬼鼠',
    dodobird: '🐦 呆呆鸟',
    tom: '🐱 Tom（刺客）',
    jerry: '🐭 Jerry（先知）',
  };
  const HEX_LABELS = {
    time_warp: '⏳ 时空错乱',
    perception_interference: '🌀 感知干涉',
  };
  const roleLabel = {
    thief: '🧀 奶酪大盗',
    mouse: '🐭 瞌睡鼠',
    accomplice: '🤝 共犯',
  };

  const isDisconnected = !player.connected;

  return (
    <div className={`glass-card p-3 md:p-4 flex flex-col items-center gap-2 transition-all relative
      ${isMe ? 'bg-cheese-400/20 ring-2 ring-cheese-400 shadow-lg shadow-cheese-400/10' : ''} 
      ${isDisconnected ? 'opacity-40' : ''}
      ${myVote === player.id ? 'ring-2 ring-red-400' : ''}
    `}>
      {isDisconnected && (
        <div className="absolute top-1 right-1 text-xs bg-red-500/80 px-1.5 py-0.5 rounded text-white">
          掉线
        </div>
      )}
      {player.ready && phase === 'waiting' && (
        <div className="absolute top-1 right-1 text-xs bg-green-500/80 px-1.5 py-0.5 rounded text-white flex items-center gap-0.5">
          <Check size={10} /> 已准备
        </div>
      )}

      {isMe && (
        <div className="absolute top-1 left-1 text-xs bg-cheese-500 text-night-900 font-bold px-1.5 py-0.5 rounded">
          我
        </div>
      )}
      <div className="text-3xl md:text-4xl">{player.avatar}</div>
      <div className="text-sm font-medium truncate max-w-full flex items-center gap-1">
        {index != null && <span className="text-white/40">{index}.</span>}
        {player.name}
        {isCreator && <Crown size={12} className="text-cheese-400 flex-shrink-0" />}
      </div>

      {/* Show role & dice only in result phase */}
      {phase === 'result' && player.role && (
        <div className={`text-xs px-2 py-0.5 rounded-full ${
          player.role === 'thief' ? 'bg-red-500/30 text-red-300' :
          player.role === 'accomplice' ? 'bg-yellow-500/30 text-yellow-300' :
          player.role === 'dodobird' ? 'bg-teal-500/30 text-teal-300' :
          'bg-blue-500/30 text-blue-300'
        }`}>
          {roleLabel[player.role] || player.role}
          {player.dice > 0 && ` ${player.dice}点`}
        </div>
      )}
      {/* Show outsider tag only in result phase */}
      {phase === 'result' && player.outsider && (
        <div className="text-xs px-2 py-0.5 rounded-full bg-purple-500/30 text-purple-300">
          {OUTSIDER_LABELS[player.outsider] || player.outsider}
        </div>
      )}
      {/* Show hex skill tag only in result phase */}
      {phase === 'result' && player.hex_skill && (
        <div className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/30 text-cyan-300">
          {HEX_LABELS[player.hex_skill] || player.hex_skill}
        </div>
      )}

      {/* Night: Peek button for mice */}
      {phase === 'night' && !isMe && onPeek && (
        <button
          onClick={() => onPeek(player.id)}
          className="text-xs btn-secondary py-1 px-3 flex items-center gap-1"
        >
          <Eye size={12} /> 偷看
        </button>
      )}

      {/* Night: Accomplice button for thief (exclude dodobird) */}
      {phase === 'night' && !isMe && canAccomplice && onAccomplice && player.id !== excludeAccomplice && (
        <button
          onClick={() => onAccomplice(player.id)}
          className="text-xs px-3 py-1 bg-purple-500/50 text-white rounded-lg hover:bg-purple-500/70 transition flex items-center gap-1"
        >
          <UserPlus size={12} /> 选为共犯
        </button>
      )}

      {/* Night: Fake accomplice button for dodobird (exclude thief) */}
      {phase === 'night' && !isMe && canDodobirdAccomplice && onDodobirdAccomplice && player.id !== excludeDodobirdAccomplice && (
        <button
          onClick={() => onDodobirdAccomplice(player.id)}
          className="text-xs px-3 py-1 bg-teal-500/50 text-white rounded-lg hover:bg-teal-500/70 transition flex items-center gap-1"
        >
          <UserPlus size={12} /> 选为假共犯
        </button>
      )}

      {/* Assassinate button for Tom (unified: works in any phase when canAssassinate, or in assassinate phase) */}
      {((canAssassinate && phase !== 'assassinate') || (phase === 'assassinate' && isMeTom)) && !isMe && onAssassinate && player.id !== noVoteTarget && (
        <button
          onClick={() => onAssassinate(player.id)}
          className={`text-xs px-3 py-1 text-white rounded-lg transition flex items-center gap-1 ${
            phase === 'assassinate' ? 'bg-red-600/70 hover:bg-red-600 animate-pulse' : 'bg-red-600/60 hover:bg-red-600/80'
          }`}
        >
          🗡️ 刺杀
        </button>
      )}

      {/* Voting: Vote button */}
      {phase === 'voting' && !isMe && (() => {
        const blocked = player.id === noVoteTarget || (voteOnlyTarget && player.id !== voteOnlyTarget);
        if (blocked) return <span className="text-xs text-white/30 py-1">不可投票</span>;
        return myVote ? (
          myVote === player.id ? (
            <span className="text-xs py-1 px-3 rounded-lg bg-red-500 text-white flex items-center gap-1">
              <Vote size={12} /> 已投票
            </span>
          ) : null
        ) : (
          onVote && (
            <button
              onClick={() => onVote(player.id)}
              className="text-xs py-1 px-3 rounded-lg transition flex items-center gap-1 bg-white/10 hover:bg-white/20 text-white"
            >
              <Vote size={12} /> 投票
            </button>
          )
        );
      })()}

      {/* Result: Vote count */}
      {phase === 'result' && player.vote_count > 0 && (
        <div className="text-xs text-red-300">
          得票: {player.vote_count}
        </div>
      )}
    </div>
  );
}

export default function Room({ ws }) {
  const { roomState, playerId, gameInfo, screenShake, send } = ws;
  const [copied, setCopied] = useState(false);
  const [assassinateTarget, setAssassinateTarget] = useState(null);
  const [countdown, setCountdown] = useState(null);

  // Countdown timer for ASSASSINATE phase
  useEffect(() => {
    if (roomState?.phase === 'assassinate') {
      setCountdown(30);
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) { clearInterval(timer); return 0; }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    } else {
      setCountdown(null);
      setAssassinateTarget(null);
    }
  }, [roomState?.phase]);

  if (!roomState) return null;

  const { room_id, phase, players, player_count, min_players, max_players, creator_id } = roomState;
  const isSpectator = !!roomState.is_spectator;
  const me = players[playerId];
  const spectators = roomState.spectators || {};
  const spectatorList = Object.values(spectators);
  const playerOrder = roomState.player_order || [];
  const playerList = playerOrder.length > 0
    ? playerOrder.filter(id => players[id]).map(id => players[id])
    : Object.values(players);

  const copyRoomId = () => {
    navigator.clipboard.writeText(room_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReady = () => {
    send('ready', { ready: !me?.ready });
  };

  const handlePeek = (targetId) => {
    send('peek', { target_id: targetId });
  };

  const handleAccomplice = (targetId) => {
    if (isMeFakeThief) {
      send('drunk_choose_accomplice', { target_id: targetId });
    } else {
      send('choose_accomplice', { target_id: targetId });
    }
  };

  const handleDodobirdAccomplice = (targetId) => {
    // Check if target is in same group as thief or self
    const sameGroup = gameInfo?.same_group || [];
    const sameGroupIds = sameGroup.map(m => m.id);
    const thiefId = gameInfo?.thief_id;
    const warnings = [];
    if (thiefId && sameGroupIds.includes(targetId) && sameGroupIds.includes(thiefId)) {
      warnings.push('该玩家和奶酪大盗同时睁眼');
    } else if (sameGroupIds.includes(targetId)) {
      warnings.push('该玩家和你同时睁眼');
    }
    if (warnings.length > 0 && !window.confirm(`⚠️ ${warnings.join('，')}，确认选择吗？`)) {
      return;
    }
    send('dodobird_choose_accomplice', { target_id: targetId });
  };

  const handleNightDone = () => {
    send('night_done', {});
  };

  const handleRequestVote = () => {
    send('request_vote', {});
  };

  const handleVote = (targetId) => {
    send('vote', { target_id: targetId });
  };

  const handleNewGame = () => {
    send('new_game', {});
  };

  const handleLeave = () => {
    send('leave_room', {});
  };

  const handleAssassinate = (targetId) => {
    setAssassinateTarget(targetId);
  };
  const confirmAssassinate = () => {
    if (assassinateTarget) {
      send('assassinate', { target_id: assassinateTarget });
      setAssassinateTarget(null);
    }
  };
  const cancelAssassinate = () => {
    setAssassinateTarget(null);
  };

  const isMeDrunk = gameInfo?.is_drunk || gameInfo?.outsider_actual === 'drunk';
  const isMeThief = gameInfo?.role === 'thief' && !isMeDrunk;
  const isMeFakeThief = gameInfo?.role === 'thief' && isMeDrunk;
  const isMeAccomplice = gameInfo?.role === 'accomplice';
  const isMeDodobird = gameInfo?.is_dodobird || gameInfo?.role === 'dodobird';
  const isMeTom = gameInfo?.is_tom || roomState?.is_tom;
  const isMeJerry = gameInfo?.is_jerry || gameInfo?.role === 'jerry';
  // Bug1: Use can_peek from night_info (respects dice group rule)
  const canPeek = phase === 'night' && gameInfo?.can_peek && !gameInfo?.has_peeked;
  const canAccomplice = phase === 'night' && (isMeThief || isMeFakeThief) && gameInfo?.can_choose_accomplice;
  const canDodobirdAccomplice = phase === 'night' && isMeDodobird && gameInfo?.can_choose_accomplice;
  const canAssassinate = isMeTom && (gameInfo?.can_assassinate || roomState?.can_assassinate);
  const isCreator = playerId === creator_id;

  return (
    <div className="w-full max-w-4xl mt-4 animate-fade-in space-y-4">
      {/* Room Header */}
      <div className="glass-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/50">房间号</span>
              <span className="text-xl font-mono font-bold text-cheese-400 tracking-wider">{room_id}</span>
              <button onClick={copyRoomId} className="p-1 hover:bg-white/10 rounded transition">
                {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} className="text-white/50" />}
              </button>
            </div>
            <div className="text-xs text-white/40 flex items-center gap-1 flex-wrap">
              <Users size={12} />
              {player_count}/{max_players} 玩家 · 最少{min_players}人开始
              <span className="mx-1">·</span>
              🎲 {roomState.max_dice || 6}面
              <span className="mx-1">·</span>
              {roomState.thief_see_all_dice ? '👁 大盗可见点数' : '🙈 大盗不可见点数'}
              {roomState.outsiders && roomState.outsiders.length > 0 && (
                <>
                  <span className="mx-1">·</span>
                  🌟 {roomState.outsiders.map(o => o === 'drunk' ? '�' : o === 'dodobird' ? '🐦' : o === 'tom_jerry' ? '🐱🐭' : '').join('')}
                </>
              )}
              {roomState.hex_skills && roomState.hex_skills.length > 0 && (
                <>
                  <span className="mx-1">·</span>
                  ⚡ {roomState.hex_skills.map(h => h === 'time_warp' ? '⏳' : h === 'perception_interference' ? '🌀' : '').join('')}
                </>
              )}
            </div>
            {isCreator && <div className="text-xs text-cheese-400 flex items-center gap-1 mt-0.5"><Crown size={10} /> 你是房主</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Phase Badge */}
          <div className={`px-3 py-1 rounded-full text-sm font-medium ${
            phase === 'waiting' ? 'bg-blue-500/30 text-blue-300' :
            phase === 'night' ? 'bg-indigo-500/30 text-indigo-300' :
            phase === 'day' ? 'bg-amber-600/30 text-amber-800' :
            phase === 'voting' ? 'bg-red-500/30 text-red-300' :
            phase === 'assassinate' ? 'bg-red-700/30 text-red-400' :
            'bg-emerald-600/30 text-emerald-800'
          }`}>
            {phase === 'waiting' && '⏳ 等待中'}
            {phase === 'night' && '🌙 夜晚'}
            {phase === 'day' && '☀️ 白天'}
            {phase === 'voting' && '🗳️ 投票'}
            {phase === 'assassinate' && '🗡️ 刺杀'}
            {phase === 'result' && '🏆 结果'}
          </div>
          {(phase === 'waiting' || isSpectator) && (
            <button onClick={handleLeave} className="p-2 hover:bg-white/10 rounded-lg transition text-white/50 hover:text-red-400">
              <LogOut size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Room Settings (creator only, waiting phase) */}
      {phase === 'waiting' && isCreator && (
        <div className="glass-card p-4">
          <div className="text-sm text-white/50 mb-3 flex items-center gap-1">
            <Settings size={14} /> 房间设置（房主）
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={roomState.thief_see_all_dice}
                onChange={(e) => send('update_room_settings', { thief_see_all_dice: e.target.checked })}
                className="accent-cheese-400"
              />
              <span className="text-white/70">👁 大盗可见所有点数</span>
            </label>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-white/70">🎲 骰子面数</span>
              <select
                value={roomState.max_dice || 6}
                onChange={(e) => send('update_room_settings', { max_dice: parseInt(e.target.value) })}
                className="bg-white/10 text-white rounded px-2 py-1 text-sm border border-white/20"
              >
                {[6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="w-full border-t border-white/10 pt-2 mt-1 flex flex-wrap gap-3">
              <span className="text-sm text-white/50">🌟 外来者：</span>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={roomState.outsiders?.includes('drunk')}
                  onChange={(e) => send('update_room_settings', { outsider_drunk: e.target.checked })}
                  className="accent-cheese-400"
                />
                <span className="text-white/70">🍻 酒鬼鼠</span>
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={roomState.outsiders?.includes('dodobird')}
                  onChange={(e) => send('update_room_settings', { outsider_dodobird: e.target.checked })}
                  className="accent-cheese-400"
                />
                <span className="text-white/70">🐦 呆呆鸟</span>
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={roomState.outsiders?.includes('tom_jerry')}
                  onChange={(e) => send('update_room_settings', { outsider_tom_jerry: e.target.checked })}
                  className="accent-cheese-400"
                />
                <span className="text-white/70">🐱🐭 Tom & Jerry</span>
              </label>
            </div>
            <div className="w-full border-t border-white/10 pt-2 mt-1 flex flex-wrap gap-3">
              <span className="text-sm text-white/50">⚡ 海克斯：</span>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={roomState.hex_skills?.includes('time_warp')}
                  onChange={(e) => send('update_room_settings', { hex_time_warp: e.target.checked })}
                  className="accent-cheese-400"
                />
                <span className="text-white/70">⏳ 时空错乱</span>
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={roomState.hex_skills?.includes('perception_interference')}
                  onChange={(e) => send('update_room_settings', { hex_perception_interference: e.target.checked })}
                  className="accent-cheese-400"
                />
                <span className="text-white/70">🌀 感知干涉</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Spectator Banner */}
      {isSpectator && (
        <div className="glass-card p-4 border-purple-500/30 text-center">
          <div className="text-3xl mb-2">👀</div>
          <div className="text-lg font-bold text-purple-300">你是观众</div>
          <div className="text-sm text-white/60">
            {phase === 'waiting' ? '等待下一局开始后你将成为正式玩家' : '你可以看到所有玩家的信息'}
          </div>
        </div>
      )}

      {/* Game Info Banner */}
      {!isSpectator && (phase === 'night' || phase === 'day' || phase === 'voting' || phase === 'assassinate') && gameInfo && (
        <div className={`glass-card p-4 ${
          (isMeThief || isMeFakeThief) ? 'border-red-500/30' : isMeAccomplice ? 'border-yellow-500/30' : isMeDodobird ? 'border-teal-500/30' : isMeJerry ? 'border-emerald-500/30' : isMeTom ? 'border-red-700/30' : 'border-blue-500/30'
        }`}>
          <div className="flex items-center gap-3">
            <div className="text-4xl">
              {isMeThief || isMeFakeThief ? '🧀' : isMeTom ? '🐱' : isMeAccomplice ? '🤝' : isMeDodobird ? '🐦' : isMeJerry ? '🐭' : '🐭'}
            </div>
            <div className="flex-1">
              <div className="font-bold text-lg">
                {isMeThief || isMeFakeThief ? <span className="text-red-400">你是奶酪大盗！</span> : isMeTom ? <span className="text-red-400">你是共犯 / Tom（刺客）！</span> : isMeAccomplice ? <span className="text-red-400">你是共犯！</span> : isMeDodobird ? <span className="text-teal-400">你是呆呆鸟！</span> : isMeJerry ? <span className="text-emerald-400">你是 Jerry（先知）！</span> : '你是瞌睡鼠'}
              </div>
              <div className="text-sm text-white/60 flex items-center gap-2">
                你的骰子: <span className="text-cheese-400 font-bold flex items-center gap-1"><DiceIcon value={gameInfo.dice} size={18} /> {gameInfo.dice}点</span>
              </div>

              {/* Night message from server (includes group/cheese/thief info) */}
              {gameInfo.message && (
                <div className="text-sm mt-1 whitespace-pre-line text-white/80">
                  {gameInfo.message}
                </div>
              )}

              {/* Same group members */}
              {gameInfo.same_group && gameInfo.same_group.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="text-xs text-white/50">同时睁眼：</span>
                  {gameInfo.same_group.map((m) => (
                    <span key={m.id} className={`text-xs px-2 py-0.5 rounded-full ${
                      m.is_thief ? 'bg-red-500/30 text-red-300' : 'bg-green-500/30 text-green-300'
                    }`}>
                      {m.avatar} {m.name} {m.is_thief ? '(大盗!)' : '(好老鼠)'}
                    </span>
                  ))}
                </div>
              )}

              {/* Peek result */}
              {gameInfo.has_peeked && gameInfo.peek_target_name && (
                <div className="text-sm text-green-300 mt-1">
                  🔍 你偷看了 {gameInfo.peek_target_name} 的骰子: <strong>{gameInfo.peek_result}</strong> 点
                </div>
              )}
              {/* Also support old peek format */}
              {gameInfo.peek && !gameInfo.has_peeked && (
                <div className="text-sm text-green-300 mt-1">
                  🔍 你偷看了 {gameInfo.peek.target_name} 的骰子: <strong>{gameInfo.peek.dice}</strong> 点
                </div>
              )}

              {/* Jerry's special message */}
              {gameInfo.jerry_message && (
                <div className="text-sm text-emerald-300 mt-1 whitespace-pre-line">
                  {gameInfo.jerry_message}
                </div>
              )}

              {/* Outsider info */}
              {gameInfo.outsider_info && (
                <div className="text-sm text-purple-300 mt-1 whitespace-pre-line">
                  {gameInfo.outsider_info}
                </div>
              )}

              {/* Hex skill info */}
              {gameInfo.hex_skill_info && (
                <div className="text-sm text-cyan-300 mt-1 whitespace-pre-line">
                  {gameInfo.hex_skill_info}
                </div>
              )}

              {/* Tom assassination hint */}
              {isMeTom && canAssassinate && phase !== 'assassinate' && (
                <div className="text-sm text-red-400 mt-1">
                  🗡️ 你可以在任意时刻刺杀一名玩家，若命中 Jerry 则大盗阵营直接获胜！（点击玩家卡片上的「刺杀」按钮）
                </div>
              )}

              {/* Accomplice info */}
              {isMeAccomplice && gameInfo.thief_name && (
                <div className="text-sm text-yellow-300 mt-1">
                  大盗是 {gameInfo.thief_name}，骰子 {gameInfo.thief_dice} 点
                </div>
              )}
              {(isMeThief || isMeFakeThief) && gameInfo.accomplice_name && (
                <div className="text-sm text-purple-300 mt-1">
                  你的共犯: {gameInfo.accomplice_name}
                </div>
              )}
              {isMeDodobird && gameInfo.accomplice_name && (
                <div className="text-sm text-teal-300 mt-1">
                  你选的假共犯: {gameInfo.accomplice_name}
                </div>
              )}
            </div>
          </div>

          {/* All dice overview: Thief, drunk mouse (fake thief), Jerry, or Dodobird */}
          {(isMeThief || isMeFakeThief || isMeJerry || isMeDodobird) && gameInfo.all_dice && (
            <div className="mt-3 p-3 bg-black/20 rounded-lg">
              <div className="text-xs text-white/50 mb-2">所有玩家骰子点数：</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(gameInfo.all_dice).map(([pid, dice]) => {
                  const p = players[pid];
                  return (
                    <div key={pid} className="flex items-center gap-1 bg-white/10 px-2 py-1 rounded text-sm">
                      <span>{p?.avatar}</span>
                      <span className="text-white/70">{p?.name}</span>
                      <span className="text-cheese-400 font-bold">{dice}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ASSASSINATE Phase Banner */}
      {phase === 'assassinate' && (
        <div className="glass-card p-6 text-center border-red-700/30">
          <div className="text-5xl mb-3 animate-pulse">🗡️</div>
          <div className="text-2xl font-bold mb-2 text-red-400">刺杀阶段！</div>
          {countdown != null && (
            <div className={`text-4xl font-bold mb-3 tabular-nums ${countdown <= 10 ? 'text-red-500 animate-pulse' : 'text-white/80'}`}>
              {countdown}s
            </div>
          )}
          <div className="text-white/60 mb-2">
            瞌睡鼠成功投票出了奶酪大盗！但 Tom（刺客）有 30 秒时间进行刺杀。
          </div>
          {isMeTom ? (
            <div className="text-lg text-red-300 font-bold animate-pulse">
              🐱 你是 Tom！选择一名玩家刺杀，猜中 Jerry 即可逆转胜局！
            </div>
          ) : (
            <div className="text-sm text-white/50">
              等待 Tom 做出选择...
            </div>
          )}
        </div>
      )}

      {/* Result Banner */}
      {phase === 'result' && roomState.winner && (
        <div className={`glass-card p-6 text-center ${
          roomState.winner === 'mouse' ? 'border-green-500/30' : 'border-red-500/30'
        }`}>
          <div className="text-5xl mb-3">
            {gameInfo?.result?.dodobird_win ? '🐦'
              : roomState.assassinate_result === 'success' ? '🐱🗡️'
              : roomState.winner === 'mouse' ? '🎉' : '😈'}
          </div>
          <div className="text-2xl font-bold mb-2">
            {gameInfo?.result?.dodobird_win
              ? '呆呆鸟胜利！'
              : roomState.assassinate_result === 'success'
                ? 'Tom 刺杀成功！大盗阵营胜利！'
                : roomState.assassinate_result === 'fail'
                  ? 'Tom 刺杀失败！瞌睡鼠胜利！'
                  : roomState.assassinate_result === 'timeout'
                    ? 'Tom 刺杀超时！瞌睡鼠胜利！'
                    : roomState.winner === 'mouse' ? '瞌睡鼠胜利！' : '奶酪大盗胜利！'}
          </div>
          <div className="text-white/60 mb-2">
            {gameInfo?.result?.dodobird_win
              ? `呆呆鸟 ${gameInfo.result.dodobird_name} 成功让自己被投票出局！`
              : roomState.assassinate_result === 'success'
                ? `Tom 正确刺杀了 Jerry！`
                : roomState.assassinate_result === 'fail'
                  ? `Tom 刺杀了错误的人，Jerry 安全了！`
                  : roomState.assassinate_result === 'timeout'
                    ? `Tom 未能在时限内行动，瞌睡鼠获胜！`
                    : roomState.winner === 'mouse'
                      ? '成功找出了奶酪大盗！'
                      : '大盗成功蒙混过关！'}
          </div>
          {gameInfo?.result && (
            <div className="text-sm text-white/50">
              奶酪大盗: {gameInfo.result.thief_name}
              {gameInfo.result.accomplice_name
                ? ` | 共犯: ${gameInfo.result.accomplice_name}`
                : gameInfo.result.no_accomplice_reason === 'mutual_selection' ? ' | 🍺↔️ 本局无共犯（大盗与酒鬼鼠互选抵消）' : ''}
              {gameInfo.result.dodobird_name && ` | 🐦 呆呆鸟: ${gameInfo.result.dodobird_name}`}
              {gameInfo.result.dodobird_accomplice_name && (
                gameInfo.result.dodobird_accomplice_is_real
                  ? ` | 🐦🤝 假共犯=${gameInfo.result.dodobird_accomplice_name}（与大盗同选→真共犯）`
                  : ` | 🐦🤝 假共犯=${gameInfo.result.dodobird_accomplice_name}（非真共犯）`
              )}
              {gameInfo.result.tom_name && ` | 🐱 Tom: ${gameInfo.result.tom_name}`}
              {gameInfo.result.jerry_name && ` | 🐭 Jerry: ${gameInfo.result.jerry_name}`}
              {gameInfo.result.hex_type && gameInfo.result.hex_target_name && ` | ⚡ ${gameInfo.result.hex_type === 'time_warp' ? '⏳时空错乱' : '🌀感知干涉'}: ${gameInfo.result.hex_target_name}`}
            </div>
          )}
        </div>
      )}

      {/* Action Log */}
      {phase === 'result' && roomState.action_log && (
        <div className="glass-card p-4">
          <div className="text-sm font-bold text-white/70 mb-3">📜 行动过程公示</div>
          <div className="space-y-3">
            {roomState.action_log.map((entry) => {
              const roleColors = {
                thief: 'border-red-500/40 bg-red-500/10',
                accomplice: 'border-yellow-500/40 bg-yellow-500/10',
                mouse: 'border-blue-500/40 bg-blue-500/10',
              };
              const roleLabels = { thief: '🧀 奶酪大盗', mouse: '🐭 瞌睡鼠', accomplice: '🤝 共犯' };
              const isMyEntry = entry.player_id === playerId;
              return (
                <div key={entry.player_id} className={`border rounded-lg p-3 relative ${roleColors[entry.role] || roleColors.mouse} ${isMyEntry ? 'ring-2 ring-cheese-400 bg-cheese-400/10' : ''}`}>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xl">{entry.avatar}</span>
                    <span className="font-medium">{entry.name}</span>
                    {isMyEntry && <span className="text-xs bg-cheese-500 text-night-900 font-bold px-1.5 py-0.5 rounded">我</span>}
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10">{roleLabels[entry.role] || entry.role}</span>
                    {entry.outsider_label && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">{entry.outsider_label}</span>
                    )}
                    {entry.hex_skill_label && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300">{entry.hex_skill_label}</span>
                    )}
                    {entry.dodobird_label && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300">{entry.dodobird_label}</span>
                    )}
                    <span className="text-xs text-cheese-400">
                      (骰子: {entry.dice}点{entry.wake_dice != null && entry.wake_dice !== entry.dice ? ` · 在${entry.wake_dice}点时醒来` : ''}{entry.display_dice != null && entry.display_dice !== entry.dice ? ` ← 以为${entry.display_dice}点` : ''})
                    </span>
                  </div>
                  <div className="pl-8 space-y-0.5">
                    {entry.actions.map((action, i) => (
                      <div key={i} className="text-sm text-white/70">{action}</div>
                    ))}
                    {entry.actions.length === 0 && (
                      <div className="text-sm text-white/30">无特殊行动</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Players Grid */}
      <div>
        <div className="text-sm text-white/50 mb-2 flex items-center gap-1">
          <Users size={14} /> 玩家列表
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {playerList.map((p, i) => (
            <PlayerCard
              key={p.id}
              player={{
                ...p,
                vote_count: roomState.vote_results?.[p.id] || 0,
              }}
              index={i + 1}
              isMe={p.id === playerId}
              isCreator={p.id === creator_id}
              isMeThief={isMeThief}
              isMeTom={isMeTom}
              phase={phase}
              onPeek={canPeek ? handlePeek : null}
              onVote={phase === 'voting' ? handleVote : null}
              onAccomplice={canAccomplice ? handleAccomplice : null}
              onDodobirdAccomplice={canDodobirdAccomplice ? handleDodobirdAccomplice : null}
              onAssassinate={(canAssassinate || phase === 'assassinate') ? handleAssassinate : null}
              myVote={me?.voted_for}
              canAccomplice={canAccomplice}
              canDodobirdAccomplice={canDodobirdAccomplice}
              canAssassinate={canAssassinate}
              excludeAccomplice={gameInfo?.dodobird_id}
              excludeDodobirdAccomplice={gameInfo?.thief_id}
              noVoteTarget={roomState.no_vote_target}
              voteOnlyTarget={roomState.vote_only_target}
            />
          ))}
        </div>
      </div>

      {/* Accomplice Full-Screen Overlay */}
      {screenShake && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-fade-in">
          <div className="text-center p-8">
            <div className="text-8xl mb-4 animate-shake">🤝</div>
            <div className="text-3xl font-bold text-yellow-400 mb-2">你被选为共犯！</div>
            <div className="text-lg text-white/80">你和奶酪大盗同赢同输</div>
          </div>
        </div>
      )}

      {/* Assassination Confirmation Modal */}
      {assassinateTarget && (() => {
        const target = players[assassinateTarget];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 animate-fade-in" onClick={cancelAssassinate}>
            <div className="glass-card p-8 max-w-sm text-center border-red-600/50 animate-fade-in" onClick={e => e.stopPropagation()}>
              <div className="text-6xl mb-4">🗡️</div>
              <div className="text-xl font-bold text-red-400 mb-2">确认刺杀</div>
              <div className="text-4xl mb-3">{target?.avatar}</div>
              <div className="text-lg font-medium text-white mb-4">{target?.name}</div>
              <div className="text-sm text-white/50 mb-6">刺杀技能只能使用一次！<br/>若命中 Jerry，大盗阵营直接获胜。</div>
              <div className="flex gap-3 justify-center">
                <button onClick={cancelAssassinate} className="px-6 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition">
                  取消
                </button>
                <button onClick={confirmAssassinate} className="px-6 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold transition animate-pulse">
                  🗡️ 确认刺杀
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Spectator List */}
      {spectatorList.length > 0 && (
        <div className="glass-card p-3">
          <div className="text-xs text-white/40 mb-1 flex items-center gap-1">👀 观众 ({spectatorList.length})</div>
          <div className="flex flex-wrap gap-2">
            {spectatorList.map(s => (
              <span key={s.id} className={`text-xs px-2 py-1 rounded-full bg-white/10 ${!s.connected ? 'opacity-40' : ''}`}>
                {s.avatar} {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="glass-card p-4 flex flex-wrap items-center justify-center gap-3">
        {isSpectator && phase !== 'waiting' && (
          <span className="text-sm text-white/40">👀 观战中，等待本局结束...</span>
        )}
        {phase === 'waiting' && !isSpectator && (
          <>
            <button
              onClick={handleReady}
              className={me?.ready ? 'btn-secondary' : 'btn-primary'}
            >
              {me?.ready ? '取消准备' : '准备'}
            </button>
            <span className="text-sm text-white/40">
              {playerList.filter(p => p.ready).length}/{player_count} 已准备
              {player_count < min_players && ` (还需${min_players - player_count}人)`}
            </span>
          </>
        )}

        {!isSpectator && phase === 'night' && (() => {
          const canEnd = gameInfo?.can_end_night;
          const iDone = gameInfo?.i_night_done;
          const btnDisabled = iDone || !canEnd;
          const doneCount = roomState.night_done_count || 0;
          const totalCount = roomState.night_total || 0;
          let hint = '';
          if (!canEnd && (isMeThief || isMeFakeThief) && !gameInfo?.accomplice_name) hint = '⚠️ 你必须先选择一名共犯';
          else if (!canEnd && gameInfo?.can_peek && !gameInfo?.has_peeked) hint = '⚠️ 请先偷看一位玩家的骰子';
          else if (!canEnd) hint = '⏳ 等待所有玩家完成夜晚操作...';
          return (
            <>
              {hint && <span className="text-sm text-yellow-400">{hint}</span>}
              <button
                onClick={handleNightDone}
                disabled={btnDisabled}
                className={btnDisabled ? 'btn-secondary opacity-60 cursor-not-allowed' : 'btn-primary'}
              >
                <span className="flex items-center gap-2">
                  <Check size={16} /> {iDone ? '已结束，等待其他人...' : '结束夜晚行动'}
                </span>
              </button>
            </>
          );
        })()}

        {!isSpectator && phase === 'day' && (
          <>
            <button
              onClick={handleRequestVote}
              disabled={roomState.i_requested_vote}
              className={roomState.i_requested_vote ? 'btn-secondary opacity-60 cursor-not-allowed' : 'btn-danger'}
            >
              <span className="flex items-center gap-2">
                <Hand size={16} /> {roomState.i_requested_vote ? '已发起' : '发起投票'}
              </span>
            </button>
            <span className="text-sm text-white/50">
              🗳️ {roomState.vote_request_count || 0}/{roomState.vote_request_required || '?'} 人发起投票
            </span>
          </>
        )}

        {!isSpectator && phase === 'voting' && (
          <div className="text-sm text-white/50">
            🗳️ 投票中 ({roomState.voted_count || 0}/{roomState.total_voters || 0})
          </div>
        )}

        {phase === 'assassinate' && !isSpectator && (
          <div className="text-sm text-white/50">
            {isMeTom
              ? '🗡️ 请在玩家列表中选择一名玩家进行刺杀！'
              : '⏳ 等待 Tom（刺客）做出选择...'
            }
          </div>
        )}

        {phase === 'result' && isCreator && (
          <button onClick={handleNewGame} className="btn-primary">
            <span className="flex items-center gap-2">
              <RotateCcw size={16} /> 再来一局
            </span>
          </button>
        )}
        {phase === 'result' && !isCreator && (
          <span className="text-sm text-white/40">等待房主开启下一局...</span>
        )}
      </div>
    </div>
  );
}
