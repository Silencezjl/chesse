import NameText from './NameText';
import Avatar from './Avatar';
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
  Copy, LogOut, Check, Eye, Vote, Users, Crown,
  Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, UserPlus, Hand
} from 'lucide-react';

const DICE_ICONS = [null, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6];

const _v = '?v=2';
const ROLE_CARD_IMAGES = {
  thief: new URL('../assets/processed/thief.jpg', import.meta.url).href + _v,
  accomplice: new URL('../assets/processed/helper.jpg', import.meta.url).href + _v,
  dodobird: new URL('../assets/processed/dodo.jpg', import.meta.url).href + _v,
};

const MOUSE_CARD_IMAGES = [
  new URL('../assets/processed/mouse_1.jpg', import.meta.url).href,
  new URL('../assets/processed/mouse_2.jpg', import.meta.url).href,
  new URL('../assets/processed/mouse_3.jpg', import.meta.url).href,
  new URL('../assets/processed/mouse_4.jpg', import.meta.url).href,
  new URL('../assets/processed/mouse_5.jpg', import.meta.url).href,
  new URL('../assets/processed/mouse_6.jpg', import.meta.url).href,
];

function stableHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const _mouseCardCache = {};
function assignMouseCards(playerIds) {
  const cacheKey = playerIds.slice().sort().join(',');
  if (_mouseCardCache[cacheKey]) return _mouseCardCache[cacheKey];
  const sorted = playerIds.slice().sort((a, b) => stableHash(a) - stableHash(b));
  const assignment = {};
  sorted.forEach((pid, i) => {
    assignment[pid] = MOUSE_CARD_IMAGES[i % MOUSE_CARD_IMAGES.length];
  });
  _mouseCardCache[cacheKey] = assignment;
  return assignment;
}

function resolveActionRoleCard(entry, mouseCardMap) {
  if (entry.outsider && ROLE_CARD_IMAGES[entry.outsider]) {
    return ROLE_CARD_IMAGES[entry.outsider];
  }
  if (entry.role === 'thief') return ROLE_CARD_IMAGES.thief;
  if (entry.role === 'accomplice') return ROLE_CARD_IMAGES.accomplice;
  return mouseCardMap?.[entry.player_id] || MOUSE_CARD_IMAGES[0];
}

function DiceIcon({ value, size = 20 }) {
  const Icon = DICE_ICONS[value];
  return Icon ? <Icon size={size} /> : <span>{value}</span>;
}

function PlayerCard({ player, index, isMe, isCreator, phase, onPeek, onVote, onAccomplice, onDodobirdAccomplice, myVote, canAccomplice, canDodobirdAccomplice, noVoteTarget, voteOnlyTarget, excludeAccomplice, excludeDodobirdAccomplice }) {
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
      <div className="text-3xl md:text-4xl"><Avatar value={player.avatar} /></div>
      <div className="text-sm font-medium truncate max-w-full flex items-center gap-1">
        {index != null && <span className="text-white/40">{index}.</span>}
        <NameText value={player.name} />
        {isCreator && <Crown size={12} className="text-cheese-400 flex-shrink-0" />}
      </div>

      {/* Show role & dice only in result phase */}
      {phase === 'result' && player.role && (
        <div className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          player.role === 'thief' ? 'bg-red-500 text-white' :
          player.role === 'accomplice' ? 'bg-yellow-400 text-yellow-900' :
          'bg-slate-200 text-slate-700'
        }`}>
          {roleLabel[player.role] || player.role}
          {player.dice > 0 && ` ${player.dice}点`}
        </div>
      )}
      {/* Show outsider tag only in result phase */}
      {phase === 'result' && player.outsider && (
        <div className="text-xs px-2 py-0.5 rounded-full bg-purple-400 text-white font-medium">
          🐦 呆呆鸟
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

      {/* Voting */}
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
  const embedded = window.self !== window.top;
  const { roomState, playerId, gameInfo, screenShake, send } = ws;
  const [copied, setCopied] = useState(false);
  const [showPrivate, setShowPrivate] = useState(false);
  const sessionId = new URLSearchParams(window.location.search).get('session');
  const viewedKey = sessionId ? `cheese-role:${sessionId}:${playerId}` : null;
  const [viewedPrivate, setViewedPrivate] = useState(() => {
    try { return !!viewedKey && sessionStorage.getItem(viewedKey) === '1'; }
    catch { return false; }
  });
  const heldPointer = useRef(null);
  const heldKey = useRef(false);
  const [confirmation, setConfirmation] = useState(null);
  useEffect(() => {
    const hide = () => { heldPointer.current = null; heldKey.current = false; setShowPrivate(false); setConfirmation(null); };
    const releasePointer = e => { if (heldPointer.current === e.pointerId) hide(); };
    const releaseKey = e => { if (heldKey.current && (e.key === ' ' || e.key === 'Enter')) hide(); };
    const message = e => { if(e.origin === location.origin && e.source === window.parent && e.data?.type === 'conceal_private') hide(); };
    document.addEventListener('visibilitychange', hide);
    document.addEventListener('pointerup', releasePointer);
    document.addEventListener('pointercancel', releasePointer);
    document.addEventListener('keyup', releaseKey);
    window.addEventListener('blur', hide);
    window.addEventListener('message', message);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      document.removeEventListener('pointerup', releasePointer);
      document.removeEventListener('pointercancel', releasePointer);
      document.removeEventListener('keyup', releaseKey);
      window.removeEventListener('blur', hide);
      window.removeEventListener('message', message);
    };
  }, []);
  useEffect(() => { setConfirmation(null); }, [roomState]);
  useLayoutEffect(() => { setShowPrivate(false); }, [roomState?.phase === 'night']);
  useEffect(() => { if(embedded) window.parent.postMessage({type:'game_connection', connected:ws.connected}, location.origin); }, [ws.connected]);
  const choose = (type, target, label) => setConfirmation({type, target, label});
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
    choose('peek', targetId, '偷看这位玩家的骰子');
  };

  const handleAccomplice = (targetId) => {
    choose('choose_accomplice', targetId, '选择这位玩家为共犯');
  };

  const handleDodobirdAccomplice = (targetId) => {
    choose('dodobird_choose_accomplice', targetId, '选择这位玩家为假共犯');
  };

  const handleNightDone = () => {
    send('night_done', {});
  };

  const handleRequestVote = () => {
    send('request_vote', {});
  };

  const handleVote = (targetId) => {
    choose('vote', targetId, '投票给这位玩家');
  };

  const handleLeave = () => { window.location.assign('/'); };

  const revealPrivate = () => {
    if (!gameInfo) return;
    setShowPrivate(true);
    setViewedPrivate(true);
    try { if (viewedKey) sessionStorage.setItem(viewedKey, '1'); } catch {}
  };

  const isMeThief = gameInfo?.role === 'thief';
  const isMeAccomplice = gameInfo?.role === 'accomplice';
  const isMeDodobird = gameInfo?.is_dodobird || gameInfo?.role === 'dodobird';
  const canPeek = phase === 'night' && !gameInfo?.has_peeked && gameInfo?.can_peek;
  const canAccomplice = phase === 'night' && isMeThief && gameInfo?.can_choose_accomplice;
  const canDodobirdAccomplice = phase === 'night' && isMeDodobird && gameInfo?.can_choose_accomplice;
  const isCreator = playerId === creator_id;
  const isBrightPhase = phase === 'day' || phase === 'voting';
  const infoTitleClass = isBrightPhase ? 'text-slate-900' : 'text-white';
  const infoTextClass = isBrightPhase ? 'text-slate-800' : 'text-white/85';
  const infoMutedClass = isBrightPhase ? 'text-slate-700' : 'text-white/70';
  const infoSoftClass = isBrightPhase ? 'text-slate-600' : 'text-white/55';
  const infoPanelClass = isBrightPhase ? 'bg-black/5 border border-black/10' : 'bg-black/20 border border-white/10';
  const infoChipClass = isBrightPhase ? 'bg-black/10 text-slate-800' : 'bg-white/10 text-white/85';
  const groupLabelClass = isBrightPhase ? 'text-slate-700' : 'text-white/60';
  const groupMouseBadgeClass = isBrightPhase ? 'bg-black/10 text-slate-800' : 'bg-white/10 text-white/90';
  const groupThiefBadgeClass = isBrightPhase ? 'bg-red-500/15 text-red-700' : 'bg-red-500/30 text-red-200';
  const roleEvilClass = isBrightPhase ? 'text-red-600' : 'text-red-400';
  const roleGoodClass = isBrightPhase ? 'text-emerald-700' : 'text-emerald-300';
  const diceValueClass = isBrightPhase ? 'text-amber-700' : 'text-cheese-300';
  const allPlayerIds = Object.keys(players);
  const mouseCardMap = assignMouseCards(allPlayerIds);

  const myRoleCardImage =
    isMeThief ? ROLE_CARD_IMAGES.thief :
    isMeAccomplice ? ROLE_CARD_IMAGES.accomplice :
    isMeDodobird ? ROLE_CARD_IMAGES.dodobird :
    mouseCardMap[playerId] || MOUSE_CARD_IMAGES[0];


  return (
    <div className="w-full max-w-4xl mt-4 animate-fade-in space-y-4">
      {/* Room Header */}
      {!embedded && <div className="glass-card p-4 flex flex-wrap items-center justify-between gap-3">
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
              {roomState.outsiders?.includes('dodobird') && <span> · 🐦 呆呆鸟</span>}
            </div>
            {isCreator && <div className="text-xs text-cheese-400 flex items-center gap-1 mt-0.5"><Crown size={10} /> 你是房主</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Phase Badge */}
          <div className={`px-3 py-1 rounded-full text-sm font-medium ${
            phase === 'waiting' ? 'bg-blue-500/30 text-blue-300' :
            phase === 'night' ? 'bg-indigo-500/30 text-indigo-300' :
            phase === 'day' ? 'bg-amber-500/30 text-amber-200' :
            phase === 'voting' ? 'bg-red-500/30 text-red-300' :
            'bg-emerald-500/30 text-emerald-200'
          }`}>
            {phase === 'waiting' && '⏳ 等待中'}
            {phase === 'night' && '🌙 夜晚'}
            {phase === 'day' && '☀️ 白天'}
            {phase === 'voting' && '🗳️ 投票'}
            {phase === 'result' && '🏆 结果'}
          </div>
          {!embedded && (phase === 'waiting' || isSpectator) && (
            <button onClick={handleLeave} className="p-2 hover:bg-white/10 rounded-lg transition text-white/50 hover:text-red-400">
              <LogOut size={18} />
            </button>
          )}
        </div>
      </div>

      }
      {/* Spectator Banner */}
      {isSpectator && (
        <div className="glass-card p-4 border-purple-500/30 text-center">
          <div className="text-3xl mb-2">👀</div>
          <div className="text-lg font-bold text-purple-300">你是观众</div>
          <div className="text-sm text-white/60">
            {phase === 'waiting' ? '等待下一局开始后你将成为正式玩家' : '身份与秘密行动在揭晓前不会显示'}
          </div>
        </div>
      )}

      <div className="glass-card p-4 space-y-3"><h2 className="font-bold text-lg">{phase === 'night' ? '🌙 完成你的夜晚行动' : phase === 'day' ? '☀️ 现在可以放下手机，面对面讨论' : phase === 'voting' ? '🗳️ 选择你要投票的玩家' : '🏆 本局结果'}</h2>
        {!isSpectator && ['night','day','voting'].includes(phase) && <button
          className="btn-secondary"
          disabled={!gameInfo}
          style={{touchAction:'none', userSelect:'none', WebkitUserSelect:'none', WebkitTouchCallout:'none'}}
          onContextMenu={e => e.preventDefault()}
          onPointerDown={e => {
            if (e.button !== 0 || heldPointer.current !== null) return;
            e.preventDefault();
            heldPointer.current = e.pointerId;
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
            revealPrivate();
          }}
          onKeyDown={e => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              if (!e.repeat) { heldKey.current = true; revealPrivate(); }
            }
          }}
        >按住查看身份与私密信息</button>}
      </div>
      {/* Game Info Banner */}
      {showPrivate && !isSpectator && (phase === 'night' || phase === 'day' || phase === 'voting') && gameInfo && (
        <div className={`glass-card p-4 ${
          isMeThief ? 'border-red-500/30' : isMeAccomplice ? 'border-yellow-500/30' : isMeDodobird ? 'border-teal-500/30' : 'border-blue-500/30'
        }`}>
          <div className="flex items-start gap-3 md:gap-4">
            <div className="w-[84px] h-[120px] md:w-[112px] md:h-[160px] shrink-0">
              <img
                src={myRoleCardImage}
                alt="角色卡牌"
                className="w-full h-full object-cover object-center rounded-[9px] shadow-lg shadow-black/30"
                loading="lazy"
              />
            </div>
            <div className="flex-1">
              <div className={`font-bold text-lg ${infoTitleClass}`}>
                {isMeThief ? <span className={roleEvilClass}>你是奶酪大盗！</span> : isMeAccomplice ? <span className={roleEvilClass}>你是共犯！</span> : isMeDodobird ? <span className={roleGoodClass}>你是呆呆鸟！</span> : '你是瞌睡鼠'}
              </div>
              <div className={`text-sm flex items-center gap-2 ${infoMutedClass}`}>
                你的骰子: <span className={`font-bold flex items-center gap-1 ${diceValueClass}`}><DiceIcon value={gameInfo.dice} size={18} /> {gameInfo.dice}点</span>
              </div>

              {/* Night message from server (includes group/cheese/thief info) */}
              {gameInfo.message && (
                <div className={`text-sm mt-1 whitespace-pre-line ${infoTextClass}`}>
                  <NameText value={gameInfo.message} />
                </div>
              )}

              {/* Same group members */}
              {gameInfo.same_group && gameInfo.same_group.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className={`text-xs ${groupLabelClass}`}>同时睁眼：</span>
                  {gameInfo.same_group.map((m) => (
                    <span key={m.id} className={`text-xs px-2 py-0.5 rounded-full ${
                      m.is_thief ? groupThiefBadgeClass : groupMouseBadgeClass
                    }`}>
                      <Avatar value={m.avatar} /> <NameText value={m.name} /> {m.is_thief ? '(大盗!)' : ''}
                    </span>
                  ))}
                </div>
              )}

              {/* Peek result */}
              {gameInfo.has_peeked && gameInfo.peek_target_name && (
                <div className={`text-sm mt-1 ${infoTextClass}`}>
                  🔍 你偷看了 <NameText value={gameInfo.peek_target_name} /> 的骰子: <strong>{gameInfo.peek_result}</strong> 点
                </div>
              )}
              {/* Also support old peek format */}
              {gameInfo.peek && !gameInfo.has_peeked && (
                <div className={`text-sm mt-1 ${infoTextClass}`}>
                  🔍 你偷看了 <NameText value={gameInfo.peek.target_name} /> 的骰子: <strong>{gameInfo.peek.dice}</strong> 点
                </div>
              )}

              {/* Accomplice info */}
              {isMeAccomplice && gameInfo.thief_name && (
                <div className={`text-sm mt-1 ${infoTextClass}`}>
                  大盗是 <NameText value={gameInfo.thief_name} />，骰子 {gameInfo.thief_dice} 点
                </div>
              )}
              {isMeThief && gameInfo.accomplice_name && (
                <div className={`text-sm mt-1 ${infoTextClass}`}>
                  你的共犯: <NameText value={gameInfo.accomplice_name} />
                </div>
              )}
              {isMeDodobird && gameInfo.accomplice_name && (
                <div className={`text-sm mt-1 ${infoTextClass}`}>
                  你选的假共犯: <NameText value={gameInfo.accomplice_name} />
                </div>
              )}
            </div>

          </div>

          {/* All dice overview */}
          {(isMeThief || isMeDodobird) && gameInfo.all_dice && (
            <div className={`mt-3 p-3 rounded-lg ${infoPanelClass}`}>
              <div className={`text-xs mb-2 ${infoSoftClass}`}>所有玩家骰子点数：</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(gameInfo.all_dice).map(([pid, dice]) => {
                  const p = players[pid];
                  return (
                    <div key={pid} className={`flex items-center gap-1 px-2 py-1 rounded text-sm ${infoChipClass}`}>
                      <span><Avatar value={p?.avatar} /></span>
                      <span className={infoMutedClass}><NameText value={p?.name} /></span>
                      <span className={`font-bold ${diceValueClass}`}>{dice}</span>
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
          <div className="text-5xl mb-3">{roomState.dodobird_id === roomState.voted_player_id ? '🐦' : roomState.winner === 'mouse' ? '🎉' : '😈'}</div>
          <div className="text-2xl font-bold mb-2">{roomState.dodobird_id && roomState.dodobird_id === roomState.voted_player_id ? '呆呆鸟胜利！' : roomState.winner === 'mouse' ? '瞌睡鼠胜利！' : '奶酪大盗胜利！'}</div>
          <div className="text-white/60 mb-2">{roomState.winner === 'dodobird' ? '呆呆鸟成功让自己被投出！' : roomState.winner === 'mouse' ? '成功找出了奶酪大盗！' : '投票结束。'}</div>
          {gameInfo?.result && (
            <div className="text-sm text-white/50">
              奶酪大盗: <NameText value={gameInfo.result.thief_name} />
              <NameText value={gameInfo.result.accomplice_name
                ? ` | 共犯: ${gameInfo.result.accomplice_name}`
                : ''} />
              <NameText value={gameInfo.result.dodobird_name ? ` | 🐦 呆呆鸟: ${gameInfo.result.dodobird_name}` : ''} />
              <NameText value={gameInfo.result.dodobird_accomplice_name ? (
                gameInfo.result.dodobird_accomplice_is_real
                  ? ` | 🐦🤝 假共犯=${gameInfo.result.dodobird_accomplice_name}（与大盗同选→真共犯）`
                  : ` | 🐦🤝 假共犯=${gameInfo.result.dodobird_accomplice_name}（非真共犯）`
              ) : ''} />
            </div>
          )}
        </div>
      )}

      {/* Action Log */}
      {phase === 'result' && roomState.action_log && (
        <details className="glass-card p-4">
          <summary className="text-sm font-bold text-white/70 mb-3">📜 查看身份与行动过程</summary>
          <div className="space-y-3">
            {roomState.action_log.map((entry) => {
              const roleColors = {
                thief: 'border-red-500/40 bg-red-500/10',
                accomplice: 'border-yellow-500/40 bg-yellow-500/10',
                mouse: 'border-blue-500/40 bg-blue-500/10',
              };
              const roleLabels = { thief: '🧀 奶酪大盗', mouse: '🐭 瞌睡鼠', accomplice: '🤝 共犯' };
              const isMyEntry = entry.player_id === playerId;
              const finalVotes = roomState.vote_results?.[entry.player_id] || 0;
              const roleCardImage = resolveActionRoleCard(entry, mouseCardMap);
              return (
                <div key={entry.player_id} className={`border rounded-lg p-3 relative ${roleColors[entry.role] || roleColors.mouse} ${isMyEntry ? 'ring-2 ring-cheese-400 bg-cheese-400/10' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-[84px] md:w-[112px] shrink-0 flex flex-col items-center gap-1.5">
                      <img
                        src={roleCardImage}
                        alt={`${entry.name}角色卡牌`}
                        className="w-full h-auto object-contain object-center rounded-[9px] shadow-md shadow-black/30"
                        loading="lazy"
                      />
                      <div className="w-full flex flex-col items-center gap-1">
                        <span className={`text-[10px] md:text-[11px] px-2 py-0.5 rounded-full font-medium ${entry.role === 'thief' ? 'bg-red-500 text-white' : entry.role === 'accomplice' ? 'bg-yellow-400 text-yellow-900' : 'bg-slate-200 text-slate-700'}`}>
                          {roleLabels[entry.role] || entry.role}
                        </span>
                        <span className="text-[11px] md:text-xs text-cheese-300 font-medium">🎲 {entry.dice}点</span>
                        <span className="text-[11px] md:text-xs text-red-300 font-medium">🗳️ {finalVotes} 票</span>
                        {(entry.wake_dice != null && entry.wake_dice !== entry.dice) && (
                          <span className="text-[10px] text-white/60 text-center leading-tight">在 {entry.wake_dice} 点时醒来</span>
                        )}
                        {(entry.display_dice != null && entry.display_dice !== entry.dice) && (
                          <span className="text-[10px] text-white/60 text-center leading-tight">以为是 {entry.display_dice} 点</span>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-lg leading-none"><Avatar value={entry.avatar} /></span>
                        <span className="font-medium break-all"><NameText value={entry.name} /></span>
                        {isMyEntry && <span className="text-xs bg-cheese-500 text-night-900 font-bold px-1.5 py-0.5 rounded">我</span>}
                        {entry.outsider_label && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-400 text-white font-medium">{entry.outsider_label}</span>
                        )}
                        {entry.dodobird_label && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-400 text-white font-medium">{entry.dodobird_label}</span>
                        )}
                      </div>

                      <div className="space-y-0.5">
                        {entry.actions.map((action, i) => (
                          <div key={i} className="text-sm text-white/70"><NameText value={action} /></div>
                        ))}
                        {entry.actions.length === 0 && (
                          <div className="text-sm text-white/30">无特殊行动</div>
                        )}
                      </div>
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* Players Grid */}
      {phase !== 'result' && (
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
                phase={phase}
                onPeek={viewedPrivate && canPeek ? handlePeek : null}
                onVote={phase === 'voting' ? handleVote : null}
                onAccomplice={viewedPrivate && canAccomplice ? handleAccomplice : null}
                onDodobirdAccomplice={viewedPrivate && canDodobirdAccomplice ? handleDodobirdAccomplice : null}
                myVote={me?.voted_for}
                canAccomplice={canAccomplice}
                canDodobirdAccomplice={canDodobirdAccomplice}
                excludeAccomplice={gameInfo?.dodobird_id}
                excludeDodobirdAccomplice={gameInfo?.thief_id}
                noVoteTarget={roomState.no_vote_target}
                voteOnlyTarget={roomState.vote_only_target}
              />
            ))}
          </div>
        </div>
      )}

      {/* Accomplice Full-Screen Overlay */}
      {showPrivate && screenShake && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-fade-in">
          <div className="text-center p-8">
            <div className="text-8xl mb-4 animate-shake">🤝</div>
            <div className="text-3xl font-bold text-yellow-400 mb-2">你被选为共犯！</div>
            <div className="text-lg text-white/80">你和奶酪大盗同赢同输</div>
          </div>
        </div>
      )}

      {/* Spectator List */}
      {spectatorList.length > 0 && (
        <div className="glass-card p-3">
          <div className="text-xs text-white/40 mb-1 flex items-center gap-1">👀 观众 ({spectatorList.length})</div>
          <div className="flex flex-wrap gap-2">
            {spectatorList.map(s => (
              <span key={s.id} className={`text-xs px-2 py-1 rounded-full bg-white/10 ${!s.connected ? 'opacity-40' : ''}`}>
                <Avatar value={s.avatar} /> <NameText value={s.name} />
              </span>
            ))}
          </div>
        </div>
      )}

      {confirmation && <div className="fixed inset-0 z-50 bg-black/80 flex items-end p-3"><section role="dialog" aria-modal="true" aria-label="确认目标" className="glass-card w-full p-5 space-y-4"><h2 className="text-lg font-bold">{confirmation.label}？</h2><p><Avatar value={players[confirmation.target]?.avatar} /> <NameText value={players[confirmation.target]?.name} /></p><div className="flex gap-3"><button className="btn-secondary flex-1" onClick={() => setConfirmation(null)}>重新选择</button><button className="btn-primary flex-1" disabled={!ws.connected || ws.actionPending} onClick={() => { send(confirmation.type, {target_id:confirmation.target}); setConfirmation(null); }}>确认提交</button></div></section></div>}
      {/* Action Buttons */}
      <fieldset disabled={!ws.connected || ws.actionPending} className="glass-card p-4 flex flex-wrap items-center justify-center gap-3">
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
          const btnDisabled = iDone || !canEnd || !viewedPrivate;
          const doneCount = roomState.night_done_count || 0;
          const totalCount = roomState.night_total || 0;
          let hint = '';
          if (!viewedPrivate) hint = '请先按住查看身份。';
          else if (!canEnd && isMeThief && !gameInfo?.accomplice_name) hint = '⚠️ 你必须先选择一名共犯';
          else if (!canEnd && isMeDodobird && gameInfo?.can_choose_accomplice && !gameInfo?.accomplice_name) hint = '⚠️ 你必须先选择一名假共犯';
          else if (!canEnd && gameInfo?.can_peek && !gameInfo?.has_peeked) hint = '⚠️ 请先偷看一位玩家的骰子';
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

        {phase === 'result' && isCreator && !embedded && (
          <button onClick={handleLeave} className="btn-primary">
            <span className="flex items-center gap-2">
              <LogOut size={16} /> 返回房间
            </span>
          </button>
        )}
        {phase === 'result' && (embedded || !isCreator) && (
          <span className="text-sm text-white/40">{embedded ? '本局结束，请返回公共房间选择下一局。' : '等待房主开启下一局...'}</span>
        )}
      </fieldset>
    </div>
  );
}
