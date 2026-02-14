// Bluetooth types for ESP32 device communication

export interface BluetoothEvent {
  evt: string;
  [key: string]: any;
}

export interface BluetoothDeviceInfo {
  id: string;
  name: string;
  connected: boolean;
}

export interface BluetoothService {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sendCommand: (cmd: string) => Promise<void>;
  isConnected: () => boolean;
  onEvent: (callback: (event: BluetoothEvent) => void) => void;
  onDisconnect: (callback: () => void) => void;
  getDeviceInfo: () => BluetoothDeviceInfo | null;
}

export interface BluetoothCharacteristics {
  rx: BluetoothRemoteGATTCharacteristic; // Write characteristic
  tx: BluetoothRemoteGATTCharacteristic; // Notify characteristic
}
