import { useEffect, useState } from 'react';
import { serialService } from '../services/serialService';
import type { BluetoothEvent } from '../types/bluetooth';
import { DeviceConfigurator } from './DeviceConfigurator';

interface SerialConnectionProps {
  onEventReceived?: (event: BluetoothEvent) => void;
  onMeshStarted?: (nodeId: number) => void;
}

export const SerialConnection = ({ onEventReceived, onMeshStarted }: SerialConnectionProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  // 'waiting' = sent /id, awaiting response | 'legacy' = old firmware detected
  const [firmwareMode, setFirmwareMode] = useState<'waiting' | 'new' | 'legacy'>('waiting');

  const isSerialSupported = 'serial' in navigator;

  useEffect(() => {
    const unsubscribeEvents = serialService.addEventListener((event: BluetoothEvent) => {
      if (onEventReceived) onEventReceived(event);

      // New firmware: responds to /id with a node_id event
      if (event.evt === 'node_id' && typeof event.nodeId === 'number') {
        setFirmwareMode('new');
        if (onMeshStarted) onMeshStarted(event.nodeId);
        return;
      }

      // mesh_ready fires on boot — send /id to retrieve node ID
      if (event.evt === 'mesh_ready') {
        serialService.sendCommand('/id').catch(() => {});
        return;
      }

      // Old firmware: setup_info or first_boot → show DeviceConfigurator
      if (event.evt === 'setup_info' || event.evt === 'first_boot') {
        setFirmwareMode('legacy');
      }
    });

    const unsubscribeDisconnect = serialService.addDisconnectListener(() => {
      setIsConnected(false);
      setFirmwareMode('waiting');
      setError('USB-Verbindung getrennt.');
    });

    return () => {
      unsubscribeEvents();
      unsubscribeDisconnect();
    };
  }, [onEventReceived, onMeshStarted]);

  const handleConnect = async () => {
    setError('');
    if (!isSerialSupported) {
      setError('Web Serial wird nicht unterstützt. Bitte Chrome oder Edge verwenden.');
      return;
    }

    setIsConnecting(true);
    try {
      await serialService.connect();
      setIsConnected(true);
      setFirmwareMode('waiting');
      // New firmware: ask for node ID immediately
      await serialService.sendCommand('/id').catch(() => {});
    } catch (err) {
      setError(`USB-Verbindung fehlgeschlagen: ${(err as Error).message}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await serialService.disconnect().catch(() => {});
    setIsConnected(false);
    setFirmwareMode('waiting');
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">ESP32 USB-Serial Verbindung</h3>

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
              <p><strong>Ziel:</strong> MegaMesh USB-Serial (115200 Baud)</p>
              <p className="mt-1">Klicke auf <em>USB verbinden</em> und wähle den COM-Port deines ESP32.</p>
            </div>

            <button
              onClick={handleConnect}
              disabled={!isSerialSupported || isConnecting}
              className="w-full flex justify-center items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isConnecting ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Verbinde…
                </>
              ) : (
                isSerialSupported ? 'USB verbinden' : 'USB Serial nicht unterstützt'
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-400 text-green-700 px-4 py-3 rounded text-sm">
              <p className="font-medium">Verbunden über USB</p>
              <p>Baudrate: 115200</p>
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
          <DeviceConfigurator onMeshStarted={onMeshStarted} transport="serial" />
        </div>
      )}
    </div>
  );
};
