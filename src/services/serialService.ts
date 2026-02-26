import type { BluetoothEvent } from '../types/bluetooth';
import { parseFirmwareLine } from './firmwareTextParser';

type EventListener = (event: BluetoothEvent) => void;

class SerialService {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private decoder = new TextDecoder();
  private rxBuffer = '';
  private readLoopRunning = false;

  private eventListeners = new Map<symbol, EventListener>();
  private disconnectListeners = new Map<symbol, () => void>();

  async connect(): Promise<void> {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial API ist nicht kompatibel mit diesem Browser');
    }

    try {
      if (this.port) {
        await this.disconnect();
      }

      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 115200 });

      if (!port.readable || !port.writable) {
        throw new Error('Serielle Schnittstelle nicht verfügbar');
      }

      this.port = port;

      this.reader = port.readable.getReader();
      this.writer = port.writable.getWriter();
      this.rxBuffer = '';

      this.readLoopRunning = true;
      this.readLoop();
    } catch (error) {
      await this.disconnect().catch(() => {});
      throw new Error(`Verbindung fehlgeschlagen: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    this.readLoopRunning = false;

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
      }
      this.reader.releaseLock();
      this.reader = null;
    }

    if (this.writer) {
      try {
        await this.writer.close();
      } catch {
      }
      this.writer.releaseLock();
      this.writer = null;
    }

    if (this.port) {
      try {
        await this.port.close();
      } catch {
      }
      this.port = null;
    }

    this.rxBuffer = '';
    this.emitDisconnect();
  }

  async sendCommand(command: string): Promise<void> {
    if (!this.writer) {
      throw new Error('Nicht verbunden');
    }

    const data = new TextEncoder().encode(`${command}\n`);
    await this.writer.write(data);
  }

  addEventListener(callback: EventListener): () => void {
    const id = Symbol();
    this.eventListeners.set(id, callback);
    return () => this.eventListeners.delete(id);
  }

  addDisconnectListener(callback: () => void): () => void {
    const id = Symbol();
    this.disconnectListeners.set(id, callback);
    return () => this.disconnectListeners.delete(id);
  }

  onEvent(callback: EventListener): void {
    this.eventListeners.set(Symbol.for('legacy_serial_onEvent'), callback);
  }

  onDisconnect(callback: () => void): void {
    this.disconnectListeners.set(Symbol.for('legacy_serial_onDisconnect'), callback);
  }

  isConnected(): boolean {
    return this.port !== null;
  }

  private async readLoop(): Promise<void> {
    while (this.readLoopRunning && this.reader) {
      try {
        const { value, done } = await this.reader.read();
        if (done) {
          break;
        }

        if (!value) {
          continue;
        }

        this.rxBuffer += this.decoder.decode(value, { stream: true });
        this.processLines();
      } catch {
        break;
      }
    }

    if (this.readLoopRunning) {
      await this.disconnect().catch(() => {});
    }
  }

  private processLines(): void {
    let newlineIndex = this.rxBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.rxBuffer.slice(0, newlineIndex).trim();
      this.rxBuffer = this.rxBuffer.slice(newlineIndex + 1);

      if (line.startsWith('{') && line.endsWith('}')) {
        try {
          const parsed = JSON.parse(line) as BluetoothEvent;
          this.emit(parsed);
        } catch {
          // JSON parse failed — try as plain-text firmware line
          const evt = parseFirmwareLine(line);
          if (evt) this.emit(evt);
        }
      } else if (line) {
        const evt = parseFirmwareLine(line);
        if (evt) this.emit(evt);
      }

      newlineIndex = this.rxBuffer.indexOf('\n');
    }
  }

  private emit(evt: BluetoothEvent): void {
    this.eventListeners.forEach(listener => {
      try {
        listener(evt);
      } catch {
      }
    });
  }

  private emitDisconnect(): void {
    this.disconnectListeners.forEach(listener => {
      try {
        listener();
      } catch {
      }
    });
  }
}

export const serialService = new SerialService();
