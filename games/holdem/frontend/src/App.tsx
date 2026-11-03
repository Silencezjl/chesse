import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import RoomPage from './pages/RoomPage';
import { useAudioUnlock } from './hooks/useAudioUnlock';

function AppContent() {
  useAudioUnlock(); // Attempt to unlock Web Audio & Speech APIs on first user interaction

  return (
    <div className="min-h-[100dvh] bg-slate-900 text-slate-200">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
