import { useState, useEffect } from 'react';
import { bluetoothService } from '../services/bluetoothService';
import type { BluetoothEvent, BluetoothDeviceInfo } from '../types/bluetooth';

interface BluetoothConnectionProps {
  onEventReceived?: (event: BluetoothEvent) => void;
}

export const BluetoothConnection = ({ onEventReceived }: BluetoothConnectionProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<BluetoothDeviceInfo | null>(null);
  const [error, setError] = useState('');
  const [command, setCommand] = useState('');
  const [events, setEvents] = useState<BluetoothEvent[]>([]);
  const [isSending, setIsSending] = useState(false);

  // Check browser 
  const isBluetoothSupported = 'bluetooth' in navigator;

  useEffect(() => {
    // Setup event handler
    bluetoothService.onEvent((event) => {
      setEvents((prev) => [event, ...prev].slice(0, 50)); 
      
     
      if (onEventReceived) {
        onEventReceived(event);
      }
    });

    
    bluetoothService.onDisconnect(() => {
      setIsConnected(false);
      setDeviceInfo(null);
      setError('Device disconnected');
    });
  }, [onEventReceived]);

  const handleConnect = async () => {
    setError('');
    
    if (!isBluetoothSupported) {
      setError('Web Bluetooth API is not supported in this browser. Please use Chrome, Edge, or Opera.');
      return;
    }

    try {
      await bluetoothService.connect();
      setIsConnected(true);
      setDeviceInfo(bluetoothService.getDeviceInfo());
      setEvents([]); 
    } catch (err) {
      const errorMessage = (err as Error).message;
      setError(`Connection failed: ${errorMessage}`);
      console.error('Connection error:', err);
    }
  };

  const handleDisconnect = async () => {
    try {
      await bluetoothService.disconnect();
      setIsConnected(false);
      setDeviceInfo(null);
    } catch (err) {
      setError(`Disconnect failed: ${(err as Error).message}`);
    }
  };

  const handleSendCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!command.trim()) return;

    setIsSending(true);
    setError('');

    try {
      await bluetoothService.sendCommand(command.trim());
      setCommand(''); // Clear input after successful send
    } catch (err) {
      setError(`Failed to send command: ${(err as Error).message}`);
    } finally {
      setIsSending(false);
    }
  };

  const clearEvents = () => {
    setEvents([]);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          ESP32 Bluetooth Connection
        </h3>
        
        {error && (
          <div className="mb-4 bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded relative">
            <span className="block sm:inline">{error}</span>
            <button
              onClick={() => setError('')}
              className="absolute top-0 right-0 px-4 py-3"
            >
              <span className="text-2xl">&times;</span>
            </button>
          </div>
        )}

        {!isConnected ? (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded">
              <p className="text-sm">
                <strong>Device:</strong> ESP32-LoRaCfg-* devices
              </p>
              <p className="text-sm mt-1">
                Click "Connect" below to scan for available ESP32 devices.
              </p>
            </div>

            <button
              onClick={handleConnect}
              disabled={!isBluetoothSupported}
              className="w-full px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isBluetoothSupported ? 'Connect to Device' : 'Bluetooth Not Supported'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-400 text-green-700 px-4 py-3 rounded">
              <p className="font-medium">Connected</p>
              {deviceInfo && (
                <>
                  <p className="text-sm">Device: {deviceInfo.name}</p>
                  <p className="text-sm">ID: {deviceInfo.id}</p>
                </>
              )}
            </div>

            {/* Command Input */}
            <form onSubmit={handleSendCommand} className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Send CLI Command
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="Enter command..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  disabled={isSending}
                />
                <button
                  type="submit"
                  disabled={isSending || !command.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {isSending ? 'Sending...' : 'Send'}
                </button>
              </div>
            </form>

            <button
              onClick={handleDisconnect}
              className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Browser Compatibility Info */}
      <div className="border-t pt-6">
        <h4 className="text-sm font-medium text-gray-900 mb-2">
          Browser Compatibility
        </h4>
        <div className="text-sm text-gray-600">
          <p>
            Web Bluetooth: {isBluetoothSupported ? '✓ Supported' : '✗ Not Supported'}
          </p>
          {!isBluetoothSupported && (
            <p className="text-xs mt-1 text-gray-500">
              Please use Chrome, Edge, or Opera for Bluetooth support.
            </p>
          )}
        </div>
      </div>

      {/* Events Log */}
      {isConnected && events.length > 0 && (
        <div className="border-t pt-6">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-medium text-gray-900">
              Events Log ({events.length})
            </h4>
            <button
              onClick={clearEvents}
              className="text-xs text-gray-600 hover:text-gray-900 underline"
            >
              Clear
            </button>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-md p-3 max-h-64 overflow-y-auto">
            <div className="space-y-2 font-mono text-xs">
              {events.map((event, index) => (
                <div
                  key={index}
                  className="bg-white border border-gray-200 rounded p-2"
                >
                  <div className="text-gray-500">
                    Event #{events.length - index}
                  </div>
                  <pre className="text-gray-800 whitespace-pre-wrap break-words">
                    {JSON.stringify(event, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
