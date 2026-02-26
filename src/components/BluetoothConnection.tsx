import { useState, useEffect } from 'react';
import { bluetoothService } from '../services/bluetoothService';
import type { BluetoothEvent, BluetoothDeviceInfo } from '../types/bluetooth';
import { DeviceConfigurator } from './DeviceConfigurator';

interface BluetoothConnectionProps {
  onEventReceived?: (event: BluetoothEvent) => void;
  onMeshStarted?: (nodeId: number) => void;
}

export const BluetoothConnection = ({ onEventReceived, onMeshStarted }: BluetoothConnectionProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<BluetoothDeviceInfo | null>(null);
  const [error, setError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  // 'waiting' = sent /id, awaiting response | 'legacy' = old firmware detected
  const [firmwareMode, setFirmwareMode] = useState<'waiting' | 'new' | 'legacy'>('waiting');

  const isBluetoothSupported = 'bluetooth' in navigator;

  useEffect(() => {
    const removeEvent = bluetoothService.addEventListener((event: BluetoothEvent) => {
      if (onEventReceived) onEventReceived(event);

      // New firmware: responds to /id with a node_id event
      if (event.evt === 'node_id' && typeof event.nodeId === 'number') {
        setFirmwareMode('new');
        if (onMeshStarted) onMeshStarted(event.nodeId);
        return;
      }

      // Also accept mesh_ready combined with a subsequent node_id
      if (event.evt === 'mesh_ready') {
        // Request node ID explicitly
        bluetoothService.sendCommand('/id').catch(() => {});
        return;
      }

      // Old firmware: sends setup_info → show DeviceConfigurator
      if (event.evt === 'setup_info' || event.evt === 'first_boot') {
        setFirmwareMode('legacy');
      }
    });

    bluetoothService.onDisconnect(() => {
      setIsConnected(false);
      setDeviceInfo(null);
      setFirmwareMode('waiting');
      setError('Gerät getrennt — versuche neu zu verbinden…');
    });

    return () => removeEvent();
  }, [onEventReceived, onMeshStarted]);

  const handleConnect = async () => {
    setError('');
    if (!isBluetoothSupported) {
      setError('Web Bluetooth wird nicht unterstützt. Bitte Chrome oder Edge verwenden.');
      return;
    }
    setIsConnecting(true);
    try {
      await bluetoothService.connect();
      setIsConnected(true);
      setFirmwareMode('waiting');
      setDeviceInfo(bluetoothService.getDeviceInfo());
      // Ask for node ID — new firmware answers immediately; old firmware ignores this
      await bluetoothService.sendCommand('/id').catch(() => {});
    } catch (err) {
      const errorObj = err as Error & { name?: string };
      const message = errorObj.message || String(err);
      const name = errorObj.name ? `${errorObj.name}: ` : '';

      if (/must be handling a user gesture/i.test(message)) {
        setError('Verbindung fehlgeschlagen: Bitte den Verbindungsbutton direkt anklicken (kein automatischer Aufruf).');
      } else {
        setError(`Verbindung fehlgeschlagen: ${name}${message}`);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await bluetoothService.disconnect().catch(() => {});
    setIsConnected(false);
    setDeviceInfo(null);
    setFirmwareMode('waiting');
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          MegaMesh Bluetooth-Verbindung
        </h3>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded relative">
            <span className="block sm:inline">{error}</span>
            <button
              onClick={() => setError('')}
              className="absolute top-0 right-0 px-4 py-3 text-2xl leading-none"
            >
              &times;
            </button>
          </div>
        )}

        {!isConnected ? (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded text-sm">
              <p><strong>Ziel:</strong> MegaMesh BLE-Geräte</p>
              <p className="mt-1">Klicke auf <em>Scannen &amp; verbinden</em>, um dein Gerät zu finden.</p>
            </div>

            <button
              onClick={handleConnect}
              disabled={!isBluetoothSupported || isConnecting}
              className="w-full flex justify-center items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isConnecting ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Suche…
                </>
              ) : (
                isBluetoothSupported ? 'Scannen & verbinden' : 'Bluetooth nicht unterstützt'
              )}
            </button>

            {!isBluetoothSupported && (
              <p className="text-xs text-gray-500">Bitte Chrome oder Edge auf Desktop oder Android verwenden.</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-400 text-green-700 px-4 py-3 rounded text-sm">
              <p className="font-medium">Verbunden</p>
              {deviceInfo && (
                <>
                  <p>Gerät: {deviceInfo.name}</p>
                  <p className="font-mono text-xs">ID: {deviceInfo.id}</p>
                </>
              )}
            </div>

            {firmwareMode === 'waiting' && (
              <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded border border-gray-200">
                <span className="inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                Warte auf Node-ID vom Gerät…
              </div>
            )}

            <button
              onClick={handleDisconnect}
              className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
            >
              Trennen
            </button>
          </div>
        )}
      </div>

      {/* Legacy firmware: show full DeviceConfigurator setup flow */}
      {isConnected && firmwareMode === 'legacy' && (
        <div className="border-t pt-6">
          <p className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded">
            Ältere Firmware erkannt — erweitertes Setup wird angezeigt.
          </p>
          <DeviceConfigurator onMeshStarted={onMeshStarted} />
        </div>
      )}
    </div>
  );
};
