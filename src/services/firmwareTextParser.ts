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

  // "RX origin=A3B4 dest=broadcast msgId=3 hops=0/7 rssi=-65.23 snr=8.5 enc=0 text=Hello"
  // "RX origin=A3B4 dest=0xFFFF msgId=3 hops=0/7 rssi=-65.23 snr=8.5 enc=1 text=Hello"
  // dest can be "broadcast" or "0x<hex>"
  const rxMatch = trimmed.match(
    /^RX origin=([0-9A-Fa-f]+) dest=(\S+) msgId=(\d+) hops=(\d+)\/(\d+) rssi=([-\d.]+) snr=([-\d.]+) enc=([01]|pub) text=(.*)$/,
  );
  if (rxMatch) {
    const dest = rxMatch[2].toLowerCase();
    return {
      evt: 'msg_rx',
      from: rxMatch[1].toLowerCase(),
      broadcast: dest === 'broadcast' || dest === '0xffff',
      msgId: parseInt(rxMatch[3], 10),
      hops: parseInt(rxMatch[4], 10),
      maxHops: parseInt(rxMatch[5], 10),
      rssi: parseFloat(rxMatch[6]),
      snr: parseFloat(rxMatch[7]),
      encrypted: rxMatch[8] !== '0',
      data: rxMatch[9],
    };
  }

  // Backward compat: old firmware without dest= field
  const rxMatchLegacy = trimmed.match(
    /^RX origin=([0-9A-Fa-f]+) msgId=(\d+) hops=(\d+)\/(\d+) rssi=([-\d.]+) snr=([-\d.]+) enc=([01]) text=(.*)$/,
  );
  if (rxMatchLegacy) {
    return {
      evt: 'msg_rx',
      from: rxMatchLegacy[1].toLowerCase(),
      broadcast: false,
      msgId: parseInt(rxMatchLegacy[2], 10),
      hops: parseInt(rxMatchLegacy[3], 10),
      maxHops: parseInt(rxMatchLegacy[4], 10),
      rssi: parseFloat(rxMatchLegacy[5]),
      snr: parseFloat(rxMatchLegacy[6]),
      encrypted: rxMatchLegacy[7] === '1',
      data: rxMatchLegacy[8],
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

  // "TX to=0xB5C6 msgId=4 text=Hello" (directed unencrypted)
  const txDirMatch = trimmed.match(/^TX to=0x([0-9A-Fa-f]+) msgId=(\d+) text=(.*)$/);
  if (txDirMatch) {
    return {
      evt: 'msg_tx',
      to: txDirMatch[1].toLowerCase(),
      msgId: parseInt(txDirMatch[2], 10),
      hops: 0,
      maxHops: 0,
      data: txDirMatch[3],
    };
  }

  // "TX msgId=5 hops=0/7 enc=pub text=Hello" (public channel)
  const txPubMatch = trimmed.match(/^TX msgId=(\d+) hops=(\d+)\/(\d+) enc=pub text=(.*)$/);
  if (txPubMatch) {
    return {
      evt: 'msg_tx',
      msgId: parseInt(txPubMatch[1], 10),
      hops: parseInt(txPubMatch[2], 10),
      maxHops: parseInt(txPubMatch[3], 10),
      data: txPubMatch[4],
      encrypted: true,
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

  // "Battery: 3.85V (71%)"
  const batteryMatch = trimmed.match(/^Battery: ([\d.]+)V \((\d+)%\)$/);
  if (batteryMatch) {
    return {
      evt: 'battery',
      voltage: parseFloat(batteryMatch[1]),
      percent: parseInt(batteryMatch[2], 10),
    };
  }

  // "TRACEROUTE to 0xB5C6: 0xA3B4>0xC7D8>0xB5C6"
  const traceMatch = trimmed.match(/^TRACEROUTE to 0x([0-9A-Fa-f]+): (.*)$/);
  if (traceMatch) {
    return {
      evt: 'traceroute',
      target: traceMatch[1].toLowerCase(),
      route: traceMatch[2],
    };
  }

  // "Eigener Key gesetzt: DEADBEEF..."  (from /mykey set)
  const mykeySetMatch = trimmed.match(/^Eigener Key gesetzt: ([0-9A-Fa-f]{32})$/i);
  if (mykeySetMatch) {
    return {
      evt: 'mykey_set',
      key: mykeySetMatch[1].toUpperCase(),
    };
  }

  // "[BLE] visibility gestoppt. BOOT-Taste druecken zum Reaktivieren."
  if (trimmed.includes('visibility gestoppt') || trimmed.includes('BLE] visibility')) {
    return { evt: 'ble_adv_stopped' };
  }

  // "[BLE] Advertising reaktiviert (BOOT-Taste)."
  if (trimmed.includes('Advertising reaktiviert')) {
    return { evt: 'ble_adv_restarted' };
  }

  // /settings JSON response — starts with {"nodeId": and is a complete JSON object
  if (trimmed.startsWith('{"nodeId":')) {
    try {
      const obj = JSON.parse(trimmed);
      return {
        evt: 'settings',
        nodeId: String(obj.nodeId ?? '').replace(/^0x/i, '').toLowerCase(),
        maxHops: obj.maxHops ?? 7,
        weatherMode: obj.weatherMode ?? false,
        personalKeyValid: obj.personalKeyValid ?? false,
        personalKey: obj.personalKey,
        loraFreq: obj.loraFreq ?? 0,
        loraBW: obj.loraBW ?? 0,
        loraSF: obj.loraSF ?? 0,
        loraCR: obj.loraCR ?? 0,
        loraPower: obj.loraPower ?? 0,
        bleConnected: obj.bleConnected ?? false,
        peerKeys: obj.peerKeys ?? 0,
        stations: obj.stations ?? 0,
        reliableSend: obj.reliableSend ?? false,
        outboundBuffered: obj.outboundBuffered ?? 0,
        sleepMode: obj.sleepMode ?? false,
        batteryV: obj.batteryV ?? 0,
        batteryPct: obj.batteryPct ?? 0,
        settingsDirty: obj.settingsDirty ?? false,
      };
    } catch {
      // not valid JSON, ignore
    }
  }

  return null;
}
