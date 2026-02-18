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

  const isBluetoothSupported = 'bluetooth' in navigator;

  useEffect(() => {
    bluetoothService.onEvent((event) => {
      if (onEventReceived) onEventReceived(event);
    });

    bluetoothService.onDisconnect(() => {
      setIsConnected(false);
      setDeviceInfo(null);
      setError('Device disconnected — trying to reconnect…');
    });
  }, [onEventReceived]);

  const handleConnect = async () => {
    setError('');
    if (!isBluetoothSupported) {
      setError('Web Bluetooth is not supported. Please use Chrome or Edge.');
      return;
    }
    setIsConnecting(true);
    try {
      await bluetoothService.connect();
      setIsConnected(true);
      setDeviceInfo(bluetoothService.getDeviceInfo());
    } catch (err) {
      setError(`Connection failed: ${(err as Error).message}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await bluetoothService.disconnect().catch(() => {});
    setIsConnected(false);
    setDeviceInfo(null);
  };

  return (
    <div className="space-y-6">
      {/* Header / connection control */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          ESP32 Bluetooth Connection
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
              <p><strong>Target:</strong> ESP32-LoRaCfg-* devices</p>
              <p className="mt-1">Click <em>Scan &amp; Connect</em> to find your device.</p>
            </div>

            <button
              onClick={handleConnect}
              disabled={!isBluetoothSupported || isConnecting}
              className="w-full flex justify-center items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isConnecting ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Scanning…
                </>
              ) : (
                isBluetoothSupported ? 'Scan & Connect' : 'Bluetooth Not Supported'
              )}
            </button>

            {!isBluetoothSupported && (
              <p className="text-xs text-gray-500">Use Chrome or Edge on desktop or Android.</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-400 text-green-700 px-4 py-3 rounded text-sm">
              <p className="font-medium">Connected</p>
              {deviceInfo && (
                <>
                  <p>Device: {deviceInfo.name}</p>
                  <p className="font-mono text-xs">ID: {deviceInfo.id}</p>
                </>
              )}
            </div>

            <button
              onClick={handleDisconnect}
              className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Dynamic configurator — shown while connected */}
      {isConnected && (
        <div className="border-t pt-6">
          <DeviceConfigurator onMeshStarted={onMeshStarted} />
        </div>
      )}
    </div>
  );
};
