import React, { useState, useEffect } from 'react';
import {
  Copy, LogOut, Check, Eye, Vote, Users,
  RotateCcw, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, UserPlus, Hand
} from 'lucide-react';

const DICE_ICONS = [null, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6];

function DiceIcon({ value, size = 20 }) {
  const Icon = DICE_ICONS[value];
  return Icon ? <Icon size={size} /> : <span>{value}</span>;
}

function PlayerCard({ player, isMe, isMeThief, phase, onPeek, onVote, onAccomplice, myVote, canAccomplice, noVoteTarget }) {
  const roleLabel = {
    thief: '🧀 奶酪大盗',
    mouse: '🐭 瞌睡鼠',
    accomplice: '🤝 共犯',
  };

  const isDisconnected = !player.connected;

  return (
    <div className={`glass-card p-3 md:p-4 flex flex-col items-center gap-2 transition-all relative
      ${isMe ? 'ring-2 ring-cheese-400' : ''} 
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

      <div className="text-3xl md:text-4xl">{player.avatar}</div>
      <div className="text-sm font-medium truncate max-w-full">{player.name}</div>

      {/* Show role for self or in result phase */}
      {player.role && (
        <div className={`text-xs px-2 py-0.5 rounded-full ${
          player.role === 'thief' ? 'bg-red-500/30 text-red-300' :
          player.role === 'accomplice' ? 'bg-yellow-500/30 text-yellow-300' :
          'bg-blue-500/30 text-blue-300'
        }`}>
          {roleLabel[player.role] || player.role}
        </div>
      )}

      {/* Show dice for self or in result phase */}
      {player.dice > 0 && (
        <div className="flex items-center gap-1 text-cheese-300">
          <DiceIcon value={player.dice} size={16} />
          <span className="text-xs">{player.dice}点</span>
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

      {/* Night: Accomplice button for thief */}
      {phase === 'night' && !isMe && canAccomplice && onAccomplice && (
        <button
          onClick={() => onAccomplice(player.id)}
          className="text-xs px-3 py-1 bg-purple-500/50 text-white rounded-lg hover:bg-purple-500/70 transition flex items-center gap-1"
        >
          <UserPlus size={12} /> 选为共犯
        </button>
      )}

      {/* Voting: Vote button */}
      {phase === 'voting' && !isMe && player.id !== noVoteTarget && (
        myVote ? (
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
        )
      )}
      {phase === 'voting' && !isMe && player.id === noVoteTarget && (
        <span className="text-xs text-white/30 py-1">不可投票</span>
      )}

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

  if (!roomState) return null;

  const { room_id, phase, players, player_count, min_players, max_players, creator_id } = roomState;
  const me = players[playerId];
  const playerList = Object.values(players);

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
    send('choose_accomplice', { target_id: targetId });
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

  const isMeThief = gameInfo?.role === 'thief';
  const isMeAccomplice = gameInfo?.role === 'accomplice';
  // Bug1: Use can_peek from night_info (respects dice group rule)
  const canPeek = phase === 'night' && gameInfo?.can_peek && !gameInfo?.has_peeked;
  const canAccomplice = phase === 'night' && isMeThief && gameInfo?.can_choose_accomplice;

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
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Phase Badge */}
          <div className={`px-3 py-1 rounded-full text-sm font-medium ${
            phase === 'waiting' ? 'bg-blue-500/30 text-blue-300' :
            phase === 'night' ? 'bg-indigo-500/30 text-indigo-300' :
            phase === 'day' ? 'bg-yellow-500/30 text-yellow-300' :
            phase === 'voting' ? 'bg-red-500/30 text-red-300' :
            'bg-green-500/30 text-green-300'
          }`}>
            {phase === 'waiting' && '⏳ 等待中'}
            {phase === 'night' && '🌙 夜晚'}
            {phase === 'day' && '☀️ 白天'}
            {phase === 'voting' && '🗳️ 投票'}
            {phase === 'result' && '🏆 结果'}
          </div>
          <button onClick={handleLeave} className="p-2 hover:bg-white/10 rounded-lg transition text-white/50 hover:text-red-400">
            <LogOut size={18} />
          </button>
        </div>
      </div>

      {/* Game Info Banner */}
      {(phase === 'night' || phase === 'day' || phase === 'voting') && gameInfo && (
        <div className={`glass-card p-4 ${
          isMeThief ? 'border-red-500/30' : isMeAccomplice ? 'border-yellow-500/30' : 'border-blue-500/30'
        }`}>
          <div className="flex items-center gap-3">
            <div className="text-4xl">
              {isMeThief ? '🧀' : isMeAccomplice ? '🤝' : '🐭'}
            </div>
            <div className="flex-1">
              <div className="font-bold text-lg">
                {isMeThief ? '你是奶酪大盗！' : isMeAccomplice ? '你是共犯！' : '你是瞌睡鼠'}
              </div>
              <div className="text-sm text-white/60">
                你的骰子: <span className="text-cheese-400 font-bold">{gameInfo.dice}</span> 点
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

              {/* Accomplice info */}
              {isMeAccomplice && gameInfo.thief_name && (
                <div className="text-sm text-yellow-300 mt-1">
                  大盗是 {gameInfo.thief_name}，骰子 {gameInfo.thief_dice} 点
                </div>
              )}
              {isMeThief && gameInfo.accomplice_name && (
                <div className="text-sm text-purple-300 mt-1">
                  你的共犯: {gameInfo.accomplice_name}
                </div>
              )}
            </div>
          </div>

          {/* Thief: All dice overview */}
          {isMeThief && gameInfo.all_dice && (
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

      {/* Result Banner */}
      {phase === 'result' && roomState.winner && (
        <div className={`glass-card p-6 text-center ${
          roomState.winner === 'mouse' ? 'border-green-500/30' : 'border-red-500/30'
        }`}>
          <div className="text-5xl mb-3">
            {roomState.winner === 'mouse' ? '🎉' : '😈'}
          </div>
          <div className="text-2xl font-bold mb-2">
            {roomState.winner === 'mouse' ? '瞌睡鼠胜利！' : '奶酪大盗胜利！'}
          </div>
          <div className="text-white/60 mb-2">
            {roomState.winner === 'mouse'
              ? '成功找出了奶酪大盗！'
              : '大盗成功蒙混过关！'}
          </div>
          {gameInfo?.result && (
            <div className="text-sm text-white/50">
              奶酪大盗: {gameInfo.result.thief_name}
              {gameInfo.result.accomplice_name && ` | 共犯: ${gameInfo.result.accomplice_name}`}
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
              const roleLabel = { thief: '🧀 奶酪大盗', mouse: '🐭 瞌睡鼠', accomplice: '🤝 共犯' };
              return (
                <div key={entry.player_id} className={`border rounded-lg p-3 ${roleColors[entry.role] || roleColors.mouse}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{entry.avatar}</span>
                    <span className="font-medium">{entry.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10">{roleLabel[entry.role] || entry.role}</span>
                    <span className="text-xs text-cheese-400">(骰子: {entry.dice}点)</span>
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
          {playerList.map((p) => (
            <PlayerCard
              key={p.id}
              player={{
                ...p,
                vote_count: roomState.vote_results?.[p.id] || 0,
              }}
              isMe={p.id === playerId}
              isMeThief={isMeThief}
              phase={phase}
              onPeek={canPeek ? handlePeek : null}
              onVote={phase === 'voting' ? handleVote : null}
              onAccomplice={canAccomplice ? handleAccomplice : null}
              myVote={me?.voted_for}
              canAccomplice={canAccomplice}
              noVoteTarget={roomState.no_vote_target}
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

      {/* Action Buttons */}
      <div className="glass-card p-4 flex flex-wrap items-center justify-center gap-3">
        {phase === 'waiting' && (
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

        {phase === 'night' && (() => {
          const canEnd = gameInfo?.can_end_night;
          const iDone = gameInfo?.i_night_done;
          const btnDisabled = iDone || !canEnd;
          const doneCount = roomState.night_done_count || 0;
          const totalCount = roomState.night_total || 0;
          let hint = '';
          if (!canEnd && isMeThief && !gameInfo?.accomplice_name) hint = '⚠️ 你必须先选择一名共犯';
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
              <span className="text-xs text-white/40">
                已结束: {doneCount}/{totalCount}
              </span>
            </>
          );
        })()}

        {phase === 'day' && (
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

        {phase === 'voting' && (
          <div className="text-sm text-white/50">
            🗳️ 投票中 ({roomState.voted_count || 0}/{roomState.total_voters || 0})
          </div>
        )}

        {phase === 'result' && (
          <button onClick={handleNewGame} className="btn-primary">
            <span className="flex items-center gap-2">
              <RotateCcw size={16} /> 再来一局
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
