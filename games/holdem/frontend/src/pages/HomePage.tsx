import Avatar from '../components/Avatar';
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { createRoom, joinRoom, fetchRooms, getRandomProfile, checkPlayerRoom } from '../api';
import { RoomListItem } from '../types';
import CreateRoomForm from '../components/CreateRoomForm';
import JoinRoomList from '../components/JoinRoomList';

const EMOJIS = window.GameAvatars?.ids || ['avatar-01'];

type Tab = 'create' | 'join';

export default function HomePage() {
  const navigate = useNavigate();
  const { playerId, playerName: savedName, playerEmoji: savedEmoji, setPlayer, setRoomId } = useStore();
  const [tab, setTab] = useState<Tab>('create');
  const [name, setName] = useState(savedName);
  const [emoji, setEmoji] = useState(savedEmoji);
  const [sb, setSb] = useState(10);
  const [initialChips, setInitialChips] = useState(1000);
  const [rebuyMin, setRebuyMin] = useState(0);
  const [handInterval, setHandInterval] = useState(5);
  const [maxChips, setMaxChips] = useState(0);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [checking, setChecking] = useState(true);

  const initProfile = useCallback(async () => {
    try {
      const p = await getRandomProfile();
      setName(p.name);
      setEmoji(p.emoji);
    } catch {
      setName('Player_' + Math.floor(Math.random() * 99));
      setEmoji('😀');
    }
  }, []);

  // Check if player is already in a room → auto-redirect
  useEffect(() => {
    checkPlayerRoom(playerId).then(res => {
      if (res.room_id) {
        setRoomId(res.room_id);
        navigate(`/room/${res.room_id}`);
      } else {
        localStorage.removeItem('holdem_room_id');
        setChecking(false);
      }
    }).catch(() => setChecking(false));
  }, [playerId, navigate, setRoomId]);

  useEffect(() => {
    if (!checking && !name && !emoji) initProfile();
  }, [checking, initProfile, name, emoji]);

  const loadRooms = useCallback(async () => {
    try {
      const data = await fetchRooms();
      setRooms(data);
    } catch { }
  }, []);

  useEffect(() => {
    if (tab === 'join') {
      loadRooms();
      const interval = setInterval(loadRooms, 3000);
      return () => clearInterval(interval);
    }
  }, [tab, loadRooms]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await createRoom({
        player_name: name.trim(),
        player_emoji: emoji,
        sb_amount: sb,
        initial_chips: initialChips,
        rebuy_minimum: rebuyMin,
        hand_interval: handInterval,
        max_chips: maxChips,
        device_id: playerId,
      });
      setPlayer(res.player_id, name.trim(), emoji);
      setRoomId(res.room_id);
      navigate(`/room/${res.room_id}`);
    } catch (e: any) {
      alert('创建失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (roomId: string) => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await joinRoom({
        room_id: roomId,
        player_name: name.trim(),
        player_emoji: emoji,
        device_id: playerId,
      });
      setPlayer(res.player_id, name.trim(), emoji);
      setRoomId(res.room_id);
      navigate(`/room/${res.room_id}`);
    } catch (e: any) {
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="flex flex-col h-[100dvh] max-w-lg mx-auto overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin text-4xl mb-4">🃏</div>
            <p className="text-slate-400">检查对局中...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] max-w-lg mx-auto overflow-hidden">
      <div className="flex-none px-4 pt-6 pb-2">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-white mb-1">🃏 Holdem Chips</h1>
          <p className="text-slate-400 text-sm">线下德扑筹码管理平台</p>
        </div>

        {/* Profile */}
        <div className="w-full bg-slate-800 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="text-4xl w-14 h-14 flex items-center justify-center bg-slate-700 rounded-full hover:bg-slate-600 transition"
            >
              <Avatar value={emoji} size={40} />
            </button>
            <input
              className="flex-1 bg-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="你的昵称"
              maxLength={20}
            />
            <button
              onClick={initProfile}
              className="text-slate-400 hover:text-white p-2"
              title="随机"
            >
              🎲
            </button>
          </div>
          {showEmojiPicker && (
            <div className="grid grid-cols-4 gap-1 mt-3 p-2 bg-slate-700 rounded-lg">
              {EMOJIS.map(e => (
                <button
                  key={e}
                  onClick={() => { setEmoji(e); setShowEmojiPicker(false); }}
                  className={`text-xl p-1 rounded hover:bg-slate-600 ${emoji === e ? 'bg-blue-600' : ''}`}
                >
                  <Avatar value={e} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="w-full flex mb-4 bg-slate-800 rounded-xl overflow-hidden">
          <button
            onClick={() => setTab('create')}
            className={`flex-1 py-3 text-center font-semibold transition ${
              tab === 'create' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            🏠 创建房间
          </button>
          <button
            onClick={() => setTab('join')}
            className={`flex-1 py-3 text-center font-semibold transition ${
              tab === 'join' ? 'bg-green-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            🚪 加入房间
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 w-full">
        {/* Tab Content */}
        {tab === 'create' ? (
          <CreateRoomForm
            sb={sb} setSb={setSb}
            initialChips={initialChips} setInitialChips={setInitialChips}
            rebuyMin={rebuyMin} setRebuyMin={setRebuyMin}
            maxChips={maxChips} setMaxChips={setMaxChips}
            handInterval={handInterval} setHandInterval={setHandInterval}
            loading={loading}
            canSubmit={Boolean(name.trim())}
            onSubmit={handleCreate}
          />
        ) : (
          <JoinRoomList
            rooms={rooms}
            loading={loading}
            onJoin={handleJoin}
            onRefresh={loadRooms}
          />
        )}
      </div>
    </div>
  );
}
