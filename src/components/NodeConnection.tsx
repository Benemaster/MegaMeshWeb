import { useState } from 'react';

export const NodeConnection = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [nodeId, setNodeId] = useState('');
  const [connectionType, setConnectionType] = useState<'usb' | 'bluetooth'>('usb');
  const [error, setError] = useState('');

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
        
        setIsConnected(true);
        setNodeId('NODE-' + Math.random().toString(36).substr(2, 9).toUpperCase());
      } else {
        if (!('bluetooth' in navigator)) {
          setError('Web Bluetooth API wird von diesem Browser nicht unterstützt.');
          return;
        }

        const device = await (navigator as any).bluetooth.requestDevice({
          filters: [{ services: ['battery_service'] }],
        });
        
        setIsConnected(true);
        setNodeId('NODE-' + Math.random().toString(36).substr(2, 9).toUpperCase());
      }
    } catch (err) {
      setError('Verbindung fehlgeschlagen: ' + (err as Error).message);
    }
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setNodeId('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Node-Verbindung
        </h3>
        
        {error && (
          <div className="mb-4 bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {!isConnected ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Verbindungstyp
              </label>
              <div className="flex space-x-4">
                <label className="inline-flex items-center">
                  <input
                    type="radio"
                    value="usb"
                    checked={connectionType === 'usb'}
                    onChange={(e) => setConnectionType(e.target.value as 'usb')}
                    className="form-radio text-primary-600"
                  />
                  <span className="ml-2">USB Serial</span>
                </label>
                <label className="inline-flex items-center">
                  <input
                    type="radio"
                    value="bluetooth"
                    checked={connectionType === 'bluetooth'}
                    onChange={(e) => setConnectionType(e.target.value as 'bluetooth')}
                    className="form-radio text-primary-600"
                  />
                  <span className="ml-2">Bluetooth</span>
                </label>
              </div>
            </div>

            <button
              onClick={handleConnect}
              className="w-full px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              Verbinden
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-400 text-green-700 px-4 py-3 rounded">
              <p className="font-medium">Verbunden</p>
              <p className="text-sm">Node-ID: {nodeId}</p>
              <p className="text-sm">Typ: {connectionType === 'usb' ? 'USB Serial' : 'Bluetooth'}</p>
            </div>

            <button
              onClick={handleDisconnect}
              className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              Trennen
            </button>
          </div>
        )}
      </div>

      <div className="border-t pt-6">
        <h4 className="text-sm font-medium text-gray-900 mb-2">
          Browser-Kompatibilität
        </h4>
        <div className="text-sm text-gray-600 space-y-1">
          <p>USB Serial: {('serial' in navigator) ? '? Unterstützt' : '? Nicht unterstützt'}</p>
          <p>Bluetooth: {('bluetooth' in navigator) ? '? Unterstützt' : '? Nicht unterstützt'}</p>
        </div>
      </div>
    </div>
  );
};
