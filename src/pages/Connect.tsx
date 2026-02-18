import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BluetoothConnection } from '../components/BluetoothConnection';
import type { BluetoothEvent } from '../types/bluetooth';

export const Connect = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isConnected, setIsConnected] = useState(false);
  const [nodeId, setNodeId] = useState('');
  const [connectionType, setConnectionType] = useState<'usb' | 'bluetooth'>('bluetooth');
  const [error, setError] = useState('');
  const [showBluetoothDetail, setShowBluetoothDetail] = useState(false);

  const handleConnect = async () => {
    setError('');
    
    try {
      if (connectionType === 'usb') {
        if (!('serial' in navigator)) {
          setError('Web Serial API wird von diesem Browser nicht unterstützt.');
          return;
        }

        const port = await (navigator as any).serial.requestPort();
        await port.open({ baudRate: 115200 });
        
        const generatedNodeId = 'NODE-' + Math.random().toString(36).slice(2, 11).toUpperCase();
        setIsConnected(true);
        setNodeId(generatedNodeId);
        localStorage.setItem('nodeId', generatedNodeId);
        localStorage.setItem('connectionType', connectionType);
      } else {
        // For Bluetooth, show the detailed connection component
        setShowBluetoothDetail(true);
      }
    } catch (err) {
      setError('Verbindung fehlgeschlagen: ' + (err as Error).message);
    }
  };

  const handleBluetoothEvent = (event: BluetoothEvent) => {
    console.log('Received Bluetooth event:', event);
  };

  const handleMeshStarted = (meshNodeId: number) => {
    const id = String(meshNodeId);
    setNodeId(id);
    setIsConnected(true);
    localStorage.setItem('nodeId', id);
    localStorage.setItem('connectionType', 'bluetooth');
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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">MegaMesh</h1>
              <p className="text-sm text-gray-600">Willkommen, {user?.username}</p>
            </div>
            <button
              onClick={logout}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md"
            >
              Abmelden
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg shadow p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            Node verbinden
          </h2>
          
          {error && (
            <div className="mb-6 bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {!isConnected && !showBluetoothDetail ? (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Verbindungstyp wählen
                </label>
                <div className="flex space-x-4">
                  <label className="inline-flex items-center">
                    <input
                      type="radio"
                      value="usb"
                      checked={connectionType === 'usb'}
                      onChange={(e) => setConnectionType(e.target.value as 'usb')}
                      className="form-radio text-primary-600 h-4 w-4"
                    />
                    <span className="ml-2">USB Serial</span>
                  </label>
                  <label className="inline-flex items-center">
                    <input
                      type="radio"
                      value="bluetooth"
                      checked={connectionType === 'bluetooth'}
                      onChange={(e) => setConnectionType(e.target.value as 'bluetooth')}
                      className="form-radio text-primary-600 h-4 w-4"
                    />
                    <span className="ml-2">Bluetooth</span>
                  </label>
                </div>
              </div>

              <button
                onClick={handleConnect}
                className="w-full px-6 py-3 bg-primary-600 text-white font-medium rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Verbinden
              </button>

              <div className="border-t pt-6">
                <h4 className="text-sm font-medium text-gray-900 mb-3">
                  Browser-Kompatibilität
                </h4>
                <div className="text-sm text-gray-600 space-y-2">
                  <p>USB Serial: {('serial' in navigator) ? '✓ Unterstützt' : '✗ Nicht unterstützt'}</p>
                  <p>Bluetooth: {('bluetooth' in navigator) ? '✓ Unterstützt' : '✗ Nicht unterstützt'}</p>
                </div>
              </div>
            </div>
          ) : showBluetoothDetail ? (
            <div className="space-y-6">
              <BluetoothConnection onEventReceived={handleBluetoothEvent} onMeshStarted={handleMeshStarted} />
              
              <button
                onClick={() => setShowBluetoothDetail(false)}
                className="w-full px-6 py-3 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              >
                Zurück zur Auswahl
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-green-50 border border-green-400 text-green-700 px-4 py-4 rounded">
                <p className="font-medium text-lg mb-2">✓ Verbunden</p>
                <p className="text-sm">Node-ID: <span className="font-mono">{nodeId}</span></p>
                <p className="text-sm">Typ: {connectionType === 'usb' ? 'USB Serial' : 'Bluetooth'}</p>
              </div>

              <button
                onClick={handleContinue}
                className="w-full px-6 py-3 bg-primary-600 text-white font-medium rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Weiter zu Nachrichten
              </button>

              <button
                onClick={handleDisconnect}
                className="w-full px-6 py-3 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
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
