import type { BluetoothEvent, BluetoothDeviceInfo, BluetoothCharacteristics } from '../types/bluetooth';

class BluetoothServiceImpl {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private characteristics: BluetoothCharacteristics | null = null;
  private eventCallback: ((event: BluetoothEvent) => void) | null = null;
  private disconnectCallback: (() => void) | null = null;

  
  private readonly FIXED_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  
  
  private readonly DEVICE_NAME_PREFIX = 'ESP32-LoRaCfg';

  
  async connect(): Promise<void> {
    try {
      
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: this.DEVICE_NAME_PREFIX }],
        optionalServices: [this.FIXED_SERVICE_UUID],
      });

      console.log('Selected device:', this.device.name || this.device.id);

     
      this.device.addEventListener('gattserverdisconnected', this.handleDisconnect.bind(this));

      
      this.server = await this.device.gatt!.connect();
      console.log('Connected to GATT server');

     
      const service = await this.server.getPrimaryService(this.FIXED_SERVICE_UUID);
      console.log('Found service:', service.uuid);

      
      const chars = await service.getCharacteristics();
      console.log('Available characteristics:', chars.map(c => ({ uuid: c.uuid, props: c.properties })));
      
      
      const rxChar = chars.find(c => c.properties.write) || null;
      const txChar = chars.find(c => c.properties.notify) || null;

      if (!rxChar || !txChar) {
        throw new Error('Required characteristics (RX/TX) not found');
      }

      console.log('Found RX (write) characteristic:', rxChar.uuid);
      console.log('Found TX (notify) characteristic:', txChar.uuid);

      this.characteristics = { rx: rxChar, tx: txChar };

     
      await txChar.startNotifications();
      txChar.addEventListener('characteristicvaluechanged', this.handleNotification.bind(this));
      
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

  /**
   * Send a CLI command to the device.
   * @param cmd - Command string to send
   */
  async sendCommand(cmd: string): Promise<void> {
    if (!this.characteristics?.rx) {
      throw new Error('Not connected to device');
    }

    try {
      // Encode command as UTF-8 
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

  
  onEvent(callback: (event: BluetoothEvent) => void): void {
    this.eventCallback = callback;
  }

  
  onDisconnect(callback: () => void): void {
    this.disconnectCallback = callback;
  }

 
  getDeviceInfo(): BluetoothDeviceInfo | null {
    if (!this.device) return null;

    return {
      id: this.device.id,
      name: this.device.name || 'Unknown Device',
      connected: this.isConnected(),
    };
  }

  
  private handleNotification(event: Event): void {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const value = target.value;
    
    if (!value) return;

    try {
      
      const text = new TextDecoder().decode(value);
      console.log('Received notification:', text);

      
      const jsonEvent: BluetoothEvent = JSON.parse(text);
      
      
      if (this.eventCallback) {
        this.eventCallback(jsonEvent);
      }
    } catch (error) {
      console.error('Failed to parse notification:', error);
    }
  }

  
  private handleDisconnect(): void {
    console.log('Device disconnected');
    this.cleanup();
    
    if (this.disconnectCallback) {
      this.disconnectCallback();
    }
  }

  
  private cleanup(): void {
    this.server = null;
    this.characteristics = null;
   
  }
}


export const bluetoothService = new BluetoothServiceImpl();
