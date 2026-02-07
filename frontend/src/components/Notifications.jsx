import React from 'react';
import { AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

const ICONS = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
};

const COLORS = {
  info: 'bg-blue-500/90 border-blue-400',
  success: 'bg-green-500/90 border-green-400',
  warning: 'bg-yellow-500/90 border-yellow-400',
  error: 'bg-red-500/90 border-red-400',
};

export default function Notifications({ notifications }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {notifications.map((n) => {
        const Icon = ICONS[n.type] || Info;
        return (
          <div
            key={n.id}
            className={`animate-fade-in flex items-center gap-2 px-4 py-3 rounded-xl border text-white text-sm shadow-lg ${COLORS[n.type]}`}
          >
            <Icon size={16} className="shrink-0" />
            <span>{n.text}</span>
          </div>
        );
      })}
    </div>
  );
}
