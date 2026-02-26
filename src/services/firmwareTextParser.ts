import type { BluetoothEvent } from '../types/bluetooth';

/**
 * Parses a single plain-text line emitted by esp32s3_heltec_lora_v3_mesh firmware
 * and returns a synthetic BluetoothEvent, or null if the line is not recognised.
 */
export function parseFirmwareLine(line: string): BluetoothEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // "Node ID: 0xA3B4"
  const nodeIdMatch = trimmed.match(/^Node ID: 0x([0-9A-Fa-f]+)$/);
  if (nodeIdMatch) {
    return { evt: 'node_id', nodeId: parseInt(nodeIdMatch[1], 16) };
  }

  // "Mesh gestartet"
  if (trimmed.startsWith('Mesh gestartet')) {
    return { evt: 'mesh_ready' };
  }

  // "RX origin=A3B4 msgId=3 hops=0/7 rssi=-65.23 snr=8.5 enc=0 text=Hello World"
  const rxMatch = trimmed.match(
    /^RX origin=([0-9A-Fa-f]+) msgId=(\d+) hops=(\d+)\/(\d+) rssi=([-\d.]+) snr=([-\d.]+) enc=([01]) text=(.*)$/,
  );
  if (rxMatch) {
    return {
      evt: 'msg_rx',
      from: rxMatch[1].toLowerCase(),
      msgId: parseInt(rxMatch[2], 10),
      hops: parseInt(rxMatch[3], 10),
      maxHops: parseInt(rxMatch[4], 10),
      rssi: parseFloat(rxMatch[5]),
      snr: parseFloat(rxMatch[6]),
      encrypted: rxMatch[7] === '1',
      data: rxMatch[8],
    };
  }

  // "DISCOVERED station=0xB5C6 hops=0 rssi=-62.5 snr=7.2"
  const discMatch = trimmed.match(
    /^DISCOVERED station=0x([0-9A-Fa-f]+) hops=(\d+) rssi=([-\d.]+) snr=([-\d.]+)/,
  );
  if (discMatch) {
    return {
      evt: 'peer_found',
      id: discMatch[1].toLowerCase(),
      hops: parseInt(discMatch[2], 10),
      rssi: parseFloat(discMatch[3]),
      snr: parseFloat(discMatch[4]),
    };
  }

  // "- 0xB5C6 last=5s rssi=-60.0 snr=9.0 hops=1"  (from /stations)
  const stationLineMatch = trimmed.match(
    /^- 0x([0-9A-Fa-f]+) last=(\d+)s rssi=([-\d.]+) snr=([-\d.]+) hops=(\d+)$/,
  );
  if (stationLineMatch) {
    return {
      evt: 'peer_found',
      id: stationLineMatch[1].toLowerCase(),
      ageMs: parseInt(stationLineMatch[2], 10) * 1000,
      rssi: parseFloat(stationLineMatch[3]),
      snr: parseFloat(stationLineMatch[4]),
      hops: parseInt(stationLineMatch[5], 10),
    };
  }

  // "TX msgId=3 hops=0/7 text=Hello"
  const txMatch = trimmed.match(/^TX msgId=(\d+) hops=(\d+)\/(\d+) text=(.*)$/);
  if (txMatch) {
    return {
      evt: 'msg_tx',
      msgId: parseInt(txMatch[1], 10),
      hops: parseInt(txMatch[2], 10),
      maxHops: parseInt(txMatch[3], 10),
      data: txMatch[4],
    };
  }

  // "ETX to=0xB5C6 msgId=4 text=Secret"
  const etxMatch = trimmed.match(/^ETX to=0x([0-9A-Fa-f]+) msgId=(\d+) text=(.*)$/);
  if (etxMatch) {
    return {
      evt: 'msg_tx_encrypted',
      to: etxMatch[1].toLowerCase(),
      msgId: parseInt(etxMatch[2], 10),
      data: etxMatch[3],
    };
  }

  // "SCAN gesendet: warte auf Antworten..."
  if (trimmed.startsWith('SCAN gesendet')) {
    return { evt: 'scan_started' };
  }

  // "Fuer andere Node fuer ID 0xA3B4 setzen mit: /key set 0xA3B4 DEADBEEF..."
  // Emitted after /mykey gen — carries nodeId and key for sharing
  const mykeyGenMatch = trimmed.match(
    /setzen mit: \/key set 0x([0-9A-Fa-f]+) ([0-9A-Fa-f]{32})$/i,
  );
  if (mykeyGenMatch) {
    return {
      evt: 'mykey_generated',
      nodeId: mykeyGenMatch[1].toLowerCase(),
      key: mykeyGenMatch[2].toUpperCase(),
    };
  }

  // "Eigener Key fuer ID 0xA3B4: DEADBEEF..."  (from /mykey show)
  const mykeyShowMatch = trimmed.match(
    /^Eigener Key fuer ID 0x([0-9A-Fa-f]+): ([0-9A-Fa-f]{32})$/i,
  );
  if (mykeyShowMatch) {
    return {
      evt: 'mykey_generated',
      nodeId: mykeyShowMatch[1].toLowerCase(),
      key: mykeyShowMatch[2].toUpperCase(),
    };
  }

  // "Key gespeichert fuer Node 0xB5C6"
  const keySavedMatch = trimmed.match(/^Key gespeichert fuer Node 0x([0-9A-Fa-f]+)$/);
  if (keySavedMatch) {
    return { evt: 'key_saved', nodeId: keySavedMatch[1].toLowerCase() };
  }

  // "Key geloescht fuer Node 0xB5C6"
  const keyDeletedMatch = trimmed.match(/^Key geloescht fuer Node 0x([0-9A-Fa-f]+)$/);
  if (keyDeletedMatch) {
    return { evt: 'key_deleted', nodeId: keyDeletedMatch[1].toLowerCase() };
  }

  // "WEATHER from=0xB5C6 hops=1 data=..."
  const wxMatch = trimmed.match(/^WEATHER from=0x([0-9A-Fa-f]+) hops=(\d+) data=(.*)$/);
  if (wxMatch) {
    return {
      evt: 'weather_rx',
      from: wxMatch[1].toLowerCase(),
      hops: parseInt(wxMatch[2], 10),
      data: wxMatch[3],
    };
  }

  return null;
}
