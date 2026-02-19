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

// --- Configurator types ---

export interface ConfigField {
  k: string;
  v: string | number;
  opts?: string;       // pipe-separated options, e.g. "heltec|wroom"
  type?: string;       // "pin" | "hex"
  unit?: string;       // e.g. "MHz", "kHz", "V"
  min?: number;
  max?: number;
}

export interface SetupInfoEvent {
  evt: 'setup_info';
  device: string;
  first_setup?: boolean;
  fields: ConfigField[];
  cmds: string;
}

export interface CfgStatusEvent {
  evt: 'cfg_status';
  saved: boolean;
  radio_ok: boolean;
  hint: string;
}

export interface RadioErrEvent {
  evt: 'radio_err';
  code: number;
}

export interface MeshStartedEvent {
  evt: 'mesh_started';
  nodeId: number;
}

export type FirmwareEvent =
  | BluetoothEvent
  | SetupInfoEvent
  | CfgStatusEvent
  | RadioErrEvent
  | MeshStartedEvent;
