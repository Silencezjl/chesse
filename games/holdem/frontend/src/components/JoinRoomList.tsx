import NameText from './NameText';
import Avatar from './Avatar';
import React from 'react';
import { RoomListItem } from '../types';

interface Props {
  rooms: RoomListItem[];
  loading: boolean;
  onJoin: (roomId: string) => void;
  onRefresh: () => void;
}

export default function JoinRoomList({ rooms, loading, onJoin, onRefresh }: Props) {
  return (
    <div className="w-full space-y-3">
      {rooms.length === 0 ? (
        <div className="bg-slate-800 rounded-xl p-8 text-center text-slate-500">
          <p className="text-4xl mb-2">🏜️</p>
          <p>暂无可加入的房间</p>
          <p className="text-xs mt-1">等待房间创建中...</p>
        </div>
      ) : (
        rooms.map(r => (
          <div key={r.id} className="bg-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl"><Avatar value={r.owner_emoji} /></span>
                <span className="font-semibold text-white"><NameText value={r.owner_name} /></span>
                <span className="text-xs bg-slate-700 px-2 py-0.5 rounded text-slate-400">#{r.id}</span>
              </div>
              <div className="flex gap-3 text-xs text-slate-400">
                <span>SB: {r.sb_amount}</span>
                <span>BB: {r.bb_amount}</span>
                <span>底池: {r.initial_chips}</span>
                <span>👥 {r.player_count}在线</span>
              </div>
            </div>
            <button
              onClick={() => onJoin(r.id)}
              disabled={loading}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-white font-medium transition"
            >
              加入
            </button>
          </div>
        ))
      )}
      <button
        onClick={onRefresh}
        className="w-full py-2 text-slate-400 hover:text-white text-sm transition"
      >
        🔄 刷新列表
      </button>
    </div>
  );
}
