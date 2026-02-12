class SerialService {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  async connect(): Promise<void> {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial API ist nicht kompatiebel mit diesem Browser');
    }

    try {
      this.port = await (navigator as any).serial.requestPort();
      await this.port.open({ baudRate: 115200 });

      const textDecoder = new TextDecoderStream();
      this.port.readable.pipeTo(textDecoder.writable);
      this.reader = textDecoder.readable.getReader();

      const textEncoder = new TextEncoderStream();
      textEncoder.readable.pipeTo(this.port.writable);
      this.writer = textEncoder.writable.getWriter();
    } catch (error) {
      throw new Error(`Failed to connect: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.reader) {
      await this.reader.cancel();
      this.reader = null;
    }

    if (this.writer) {
      await this.writer.close();
      this.writer = null;
    }

    if (this.port) {
      await this.port.close();
      this.port = null;
    }
  }

  async sendMessage(message: string): Promise<void> {
    if (!this.writer) {
      throw new Error('Not connected');
    }

    await this.writer.write(message + '\n');
  }

  async readMessage(): Promise<string> {
    if (!this.reader) {
      throw new Error('Not connected');
    }

    const { value, done } = await this.reader.read();
    if (done) {
      throw new Error('Stream closed');
    }

    return value;
  }

  isConnected(): boolean {
    return this.port !== null;
  }
}

export const serialService = new SerialService();
