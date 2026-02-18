import type { BluetoothEvent, BluetoothDeviceInfo, BluetoothCharacteristics } from '../types/bluetooth';

type EventListener = (event: BluetoothEvent) => void;

class BluetoothServiceImpl {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private characteristics: BluetoothCharacteristics | null = null;

  // Multi-listener maps — keyed by symbol so removal is O(1) and no ordering issues
  private eventListeners = new Map<symbol, EventListener>();
  private disconnectListeners = new Map<symbol, () => void>();

  // BLE packet reassembly buffer (long JSON may arrive split across MTU chunks)
  private rxBuffer = '';

  private readonly FIXED_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  private readonly RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  private readonly TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
  private readonly DEVICE_NAME_PREFIX = 'ESP32-LoRaCfg';

  // ── Public API ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: this.DEVICE_NAME_PREFIX }],
        optionalServices: [this.FIXED_SERVICE_UUID],
      });

      console.log('Selected device:', this.device.name || this.device.id);
      this.device.addEventListener('gattserverdisconnected', this.handleDisconnect.bind(this));

      await this.connectGatt();
      console.log('✓ Bluetooth connection established and notifications started');
    } catch (error) {
      console.error('Bluetooth connection failed:', error);
      this.cleanup();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.server?.connected) {
        this.server.disconnect();
      }
      this.cleanup();
      console.log('Disconnected from Bluetooth device');
    } catch (error) {
      console.error('Error during disconnect:', error);
      this.cleanup();
    }
  }

  async sendCommand(cmd: string): Promise<void> {
    if (!this.characteristics?.rx) {
      throw new Error('Not connected to device');
    }
    try {
      const data = new TextEncoder().encode(cmd + '\n');
      await this.characteristics.rx.writeValue(data);
      console.log('Sent command:', cmd);
    } catch (error) {
      console.error('Failed to send command:', error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.server?.connected ?? false;
  }

  /**
   * Register an event listener.
   * Returns a cleanup function — call it (in useEffect cleanup) to unsubscribe.
   */
  addEventListener(callback: EventListener): () => void {
    const id = Symbol();
    this.eventListeners.set(id, callback);
    return () => this.eventListeners.delete(id);
  }

  /**
   * Register a disconnect listener.
   * Returns a cleanup function.
   */
  addDisconnectListener(callback: () => void): () => void {
    const id = Symbol();
    this.disconnectListeners.set(id, callback);
    return () => this.disconnectListeners.delete(id);
  }

  /**
   * @deprecated — kept for backward compat. Uses a stable well-known key so
   * repeated calls replace the previous entry instead of stacking up.
   */
  onEvent(callback: EventListener): void {
    this.eventListeners.set(Symbol.for('legacy_onEvent'), callback);
  }

  /** @deprecated */
  onDisconnect(callback: () => void): void {
    this.disconnectListeners.set(Symbol.for('legacy_onDisconnect'), callback);
  }

  getDeviceInfo(): BluetoothDeviceInfo | null {
    if (!this.device) return null;
    return {
      id: this.device.id,
      name: this.device.name || 'Unknown Device',
      connected: this.isConnected(),
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async connectGatt(): Promise<void> {
    if (!this.device) throw new Error('No device selected');

    this.server = await this.device.gatt!.connect();
    console.log('Connected to GATT server');

    const service = await this.server.getPrimaryService(this.FIXED_SERVICE_UUID);

    let rxChar: BluetoothRemoteGATTCharacteristic | null = null;
    let txChar: BluetoothRemoteGATTCharacteristic | null = null;
    try {
      rxChar = await service.getCharacteristic(this.RX_CHAR_UUID);
      txChar = await service.getCharacteristic(this.TX_CHAR_UUID);
    } catch {
      const chars = await service.getCharacteristics();
      rxChar = chars.find(c => c.properties.write || c.properties.writeWithoutResponse) ?? null;
      txChar = chars.find(c => c.properties.notify) ?? null;
    }

    if (!rxChar || !txChar) {
      throw new Error('Required characteristics (RX/TX) not found');
    }

    this.characteristics = { rx: rxChar, tx: txChar };
    this.rxBuffer = '';

    await txChar.startNotifications();
    txChar.addEventListener('characteristicvaluechanged', this.handleNotification.bind(this));
  }

  private emit(evt: BluetoothEvent): void {
    this.eventListeners.forEach(fn => {
      try { fn(evt); } catch (e) { console.error('Event listener threw:', e); }
    });
  }

  private emitDisconnect(): void {
    this.disconnectListeners.forEach(fn => {
      try { fn(); } catch (e) { console.error('Disconnect listener threw:', e); }
    });
  }

  private handleNotification(event: Event): void {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const value = target.value;
    if (!value) return;

    this.rxBuffer += new TextDecoder().decode(value);

    let start = 0;
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < this.rxBuffer.length; i++) {
      const ch = this.rxBuffer[i];

      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = this.rxBuffer.slice(start, i + 1);
          try {
            const obj: BluetoothEvent = JSON.parse(candidate);
            console.log('Received event:', obj);
            this.emit(obj);
          } catch {
            console.warn('Failed to parse extracted JSON:', candidate);
          }
          this.rxBuffer = this.rxBuffer.slice(i + 1);
          i = -1;
          depth = 0;
          inString = false;
          escape = false;
        }
      }
    }

    if (this.rxBuffer.length > 4096) {
      console.warn('RX buffer overflow — clearing');
      this.rxBuffer = '';
    }
  }

  private async handleDisconnect(): Promise<void> {
    console.log('Device disconnected — attempting auto-reconnect…');
    this.server = null;
    this.characteristics = null;

    if (!this.device) {
      this.emitDisconnect();
      return;
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        await this.connectGatt();
        console.log('Auto-reconnect succeeded on attempt', attempt);
        this.emit({ evt: 'reconnected' });
        return;
      } catch (err) {
        console.warn(`Auto-reconnect attempt ${attempt} failed:`, err);
      }
    }

    console.error('Auto-reconnect failed after 3 attempts');
    this.cleanup();
    this.emitDisconnect();
  }

  private cleanup(): void {
    this.server = null;
    this.characteristics = null;
    this.rxBuffer = '';
  }
}

export const bluetoothService = new BluetoothServiceImpl();
