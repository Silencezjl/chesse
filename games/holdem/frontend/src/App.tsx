import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import RoomPage from './pages/RoomPage';
import { useAudioUnlock } from './hooks/useAudioUnlock';

function RedirectToLobby() {
  React.useEffect(() => {
    if (window.parent === window) window.location.replace('/');
  }, []);
  return window.parent === window ? null : <p>游戏连接已结束，请返回房间。</p>;
}

function AppContent() {
  useAudioUnlock(); // Attempt to unlock Web Audio & Speech APIs on first user interaction

  return (
    <div className="min-h-[100dvh] bg-slate-900 text-slate-200">
      <Routes>
        <Route path="/" element={<RedirectToLobby />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter basename="/holdem">
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
