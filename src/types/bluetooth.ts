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

// --- New firmware plain-text events (esp32s3_heltec_lora_v3_mesh) ---

export interface NodeIdEvent {
  evt: 'node_id';
  nodeId: number;
}

export interface MeshReadyEvent {
  evt: 'mesh_ready';
}

export interface MsgRxEvent {
  evt: 'msg_rx';
  from: string;
  msgId: number;
  hops: number;
  maxHops: number;
  rssi: number;
  snr: number;
  encrypted: boolean;
  data: string;
}

export interface MsgTxEvent {
  evt: 'msg_tx';
  msgId: number;
  hops: number;
  maxHops: number;
  data: string;
}

export interface MsgTxEncryptedEvent {
  evt: 'msg_tx_encrypted';
  to: string;
  msgId: number;
  data: string;
}

export interface PeerFoundEvent {
  evt: 'peer_found';
  id: string;
  rssi?: number;
  snr?: number;
  hops?: number;
  ageMs?: number;
}

export interface ScanStartedEvent {
  evt: 'scan_started';
}

export interface MykeyGeneratedEvent {
  evt: 'mykey_generated';
  nodeId: string;
  key: string;
}

export interface KeySavedEvent {
  evt: 'key_saved';
  nodeId: string;
}

export interface KeyDeletedEvent {
  evt: 'key_deleted';
  nodeId: string;
}

export interface WeatherRxEvent {
  evt: 'weather_rx';
  from: string;
  hops: number;
  data: string;
}

export type FirmwareEvent =
  | BluetoothEvent
  | SetupInfoEvent
  | CfgStatusEvent
  | RadioErrEvent
  | MeshStartedEvent
  | NodeIdEvent
  | MeshReadyEvent
  | MsgRxEvent
  | MsgTxEvent
  | MsgTxEncryptedEvent
  | PeerFoundEvent
  | ScanStartedEvent
  | MykeyGeneratedEvent
  | KeySavedEvent
  | KeyDeletedEvent
  | WeatherRxEvent;
