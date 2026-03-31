import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BluetoothConnection } from '../components/BluetoothConnection';
import { SerialConnection } from '../components/SerialConnection';
import type { BluetoothEvent } from '../types/bluetooth';

export const Connect = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isConnected, setIsConnected] = useState(false);
  const [nodeId, setNodeId] = useState('');
  const [connectionType, setConnectionType] = useState<'usb' | 'bluetooth'>('bluetooth');
  const [error, setError] = useState('');
  const [showBluetoothDetail, setShowBluetoothDetail] = useState(false);
  const [showSerialDetail, setShowSerialDetail] = useState(false);

  const handleConnect = async () => {
    setError('');
    
    try {
      if (connectionType === 'usb') {
        setShowSerialDetail(true);
        setShowBluetoothDetail(false);
      } else {
        // For Bluetooth, show the detailed connection component
        setShowBluetoothDetail(true);
        setShowSerialDetail(false);
      }
    } catch (err) {
      setError('Verbindung fehlgeschlagen: ' + (err as Error).message);
    }
  };

  const handleBluetoothEvent = (event: BluetoothEvent) => {
    console.log('Received Bluetooth event:', event);
  };

  const handleMeshStarted = (meshNodeId: number) => {
    const id = meshNodeId.toString(16);
    setNodeId(id);
    setIsConnected(true);
    setShowBluetoothDetail(false);
    setShowSerialDetail(false);
    localStorage.setItem('nodeId', id);
    localStorage.setItem('connectionType', connectionType);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setNodeId('');
    localStorage.removeItem('nodeId');
    localStorage.removeItem('connectionType');
  };

  const handleContinue = () => {
    if (isConnected) {
      navigate('/messages');
    }
  };

  return (
    <div className="mesh-bg min-h-screen bg-surface">
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-[400px] w-[400px] rounded-full bg-primary-600/8 blur-[100px]" />
        <div className="absolute -bottom-40 right-1/4 h-[300px] w-[300px] rounded-full bg-cyber-500/8 blur-[100px]" />
      </div>

      <header className="relative z-10 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-cyber-500">
                <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">MegaMesh</h1>
                <p className="text-xs text-gray-500">Willkommen, {user?.username}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="btn-danger"
            >
              Abmelden
            </button>
          </div>
        </div>
      </header>

      <div className="relative z-10 max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="glass-card glow-border p-8 animate-fade-in-up">
          <h2 className="text-2xl font-bold text-white mb-2">
            Node verbinden
          </h2>
          <p className="text-sm text-gray-400 mb-6">
            Verbinde deinen ESP32 um das Mesh-Netzwerk zu nutzen
          </p>
          
          {error && (
            <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {!isConnected && !showBluetoothDetail && !showSerialDetail ? (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">
                  Verbindungstyp waehlen
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setConnectionType('usb')}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-5 transition-all duration-200 ${
                      connectionType === 'usb'
                        ? 'border-primary-500/40 bg-primary-500/10 shadow-glow-sm'
                        : 'border-white/10 bg-surface-200/50 hover:border-white/20 hover:bg-surface-300/50'
                    }`}
                  >
                    <svg className={`h-8 w-8 ${connectionType === 'usb' ? 'text-primary-400' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-3-3m3 3l3-3M5.636 18.364A9 9 0 1112 21a9 9 0 01-6.364-2.636z" />
                    </svg>
                    <span className={`text-sm font-medium ${connectionType === 'usb' ? 'text-primary-300' : 'text-gray-300'}`}>USB-Seriell</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConnectionType('bluetooth')}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-5 transition-all duration-200 ${
                      connectionType === 'bluetooth'
                        ? 'border-primary-500/40 bg-primary-500/10 shadow-glow-sm'
                        : 'border-white/10 bg-surface-200/50 hover:border-white/20 hover:bg-surface-300/50'
                    }`}
                  >
                    <svg className={`h-8 w-8 ${connectionType === 'bluetooth' ? 'text-primary-400' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12l6-6v4.5l4.5-4.5L12 12l4.5 6-4.5-4.5V18l-6-6z" />
                    </svg>
                    <span className={`text-sm font-medium ${connectionType === 'bluetooth' ? 'text-primary-300' : 'text-gray-300'}`}>Bluetooth</span>
                  </button>
                </div>
              </div>

              <button
                onClick={handleConnect}
                className="btn-primary w-full py-3"
              >
                Verbinden
              </button>

              <div className="rounded-lg border border-white/5 bg-surface-100/50 p-4">
                <h4 className="text-xs font-semibold text-gray-300 mb-3">
                  Browser-Kompatibilitaet
                </h4>
                <div className="space-y-2 text-sm text-gray-400">
                  <div className="flex items-center gap-2">
                    <span className={`flex h-5 w-5 items-center justify-center rounded text-xs ${('serial' in navigator) ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                      {('serial' in navigator) ? '✓' : '✗'}
                    </span>
                    USB Serial
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`flex h-5 w-5 items-center justify-center rounded text-xs ${('bluetooth' in navigator) ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                      {('bluetooth' in navigator) ? '✓' : '✗'}
                    </span>
                    Bluetooth
                  </div>
                </div>
              </div>
            </div>
          ) : showBluetoothDetail ? (
            <div className="space-y-6">
              <BluetoothConnection onEventReceived={handleBluetoothEvent} onMeshStarted={handleMeshStarted} />
              
              <button
                onClick={() => setShowBluetoothDetail(false)}
                className="btn-secondary w-full py-3"
              >
                Zurueck zur Auswahl
              </button>
            </div>
          ) : showSerialDetail ? (
            <div className="space-y-6">
              <SerialConnection onEventReceived={handleBluetoothEvent} onMeshStarted={handleMeshStarted} />

              <button
                onClick={() => setShowSerialDetail(false)}
                className="btn-secondary w-full py-3"
              >
                Zurueck zur Auswahl
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
                    <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-green-300">Verbunden</p>
                    <p className="text-xs text-gray-400">
                      Node <span className="font-mono text-green-400">0x{nodeId}</span> · {connectionType === 'usb' ? 'USB-Seriell' : 'Bluetooth'}
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={handleContinue}
                className="btn-primary w-full py-3"
              >
                Weiter zu Nachrichten
              </button>

              <button
                onClick={handleDisconnect}
                className="btn-secondary w-full py-3"
              >
                Verbindung trennen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
