export interface Message {
  id: string;
  content: string;
  sender: string;
  receiver: string;
  timestamp: Date;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  via: 'radio' | 'backend';
}

export interface Node {
  id: string;
  name: string;
  address: string;
  isConnected: boolean;
  lastSeen?: Date;
}

export interface SerialConnection {
  port: SerialPort | null;
  isConnected: boolean;
  nodeId: string | null;
}
