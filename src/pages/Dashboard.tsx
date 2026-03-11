import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageList } from '../components/MessageList';
import { MessageInput } from '../components/MessageInput';
import { ContactList, type MeshContact } from '../components/ContactList';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { bluetoothService } from '../services/bluetoothService';
import { serialService } from '../services/serialService';
import type { BluetoothEvent } from '../types/bluetooth';
import type { Message } from '../types/messaging';
import {
  generateKeyHex,
  isValidKeyHex,
} from '../utils/aes128';

// ─── localStorage keys ────────────────────────────────────────────────────────
const LS_MY_KEY = 'meshMyKey';
const LS_PEER_KEYS = 'meshPeerKeys';

function loadPeerKeys(): Map<string, string> {
  try {
    const raw = localStorage.getItem(LS_PEER_KEYS);
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch {
    return new Map();
  }
}

function savePeerKeys(map: Map<string, string>): void {
  localStorage.setItem(LS_PEER_KEYS, JSON.stringify(Object.fromEntries(map)));
}

// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC_CHANNEL_ID = 'public';

const normalizeNodeId = (value: string | number): string => String(value).trim().toLowerCase();

export const Dashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [contacts, setContacts] = useState<MeshContact[]>([]);
  const [messagesByContact, setMessagesByContact] = useState<Record<string, Message[]>>({});
  const [statusInfo, setStatusInfo] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  // AES-128 state — loaded from/persisted to localStorage
  const [myKey, setMyKey] = useState<string>(() => localStorage.getItem(LS_MY_KEY) ?? '');
  const [myKeyNodeId, setMyKeyNodeId] = useState<string>(
    () => localStorage.getItem('nodeId') ?? '',
  );
  const [webPeerKeys, setWebPeerKeys] = useState<Map<string, string>>(loadPeerKeys);
  const webPeerKeysRef = useRef(webPeerKeys);
  const [peerKeyStatus, setPeerKeyStatus] = useState('');

  // Device settings from /settings command
  const [deviceSettings, setDeviceSettings] = useState<{
    batteryV?: number;
    batteryPct?: number;
    loraPower?: number;
    maxHops?: number;
    reliableSend?: boolean;
    sleepMode?: boolean;
    weatherMode?: boolean;
    loraFreq?: number;
    loraSF?: number;
  } | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Keep ref in sync so async event handlers always see current keys
  useEffect(() => {
    webPeerKeysRef.current = webPeerKeys;
  }, [webPeerKeys]);

  const nodeId = localStorage.getItem('nodeId');
  const connectionType = localStorage.getItem('connectionType');
  const commandService = connectionType === 'usb' ? serialService : bluetoothService;

  const appendMessage = (contactId: string, message: Message) => {
    setMessagesByContact(prev => ({
      ...prev,
      [contactId]: [...(prev[contactId] ?? []), message],
    }));
  };

  const upsertContact = (id: string, isOnline = true, lastSeenMs?: number) => {
    setContacts(prev => {
      const existing = prev.find(item => item.id === id);
      if (existing) {
        return prev.map(item =>
          item.id === id ? { ...item, isOnline: isOnline || item.isOnline, lastSeenMs } : item,
        );
      }
      return [{ id, name: `Node ${id}`, isOnline, lastSeenMs }, ...prev];
    });
  };

  useEffect(() => {
    const removeEvent = commandService.addEventListener((event: BluetoothEvent) => {
      switch (event.evt) {
        case 'node_id': {
          const hexId = (event.nodeId as number).toString(16);
          localStorage.setItem('nodeId', hexId);
          setMyKeyNodeId(hexId);
          break;
        }

        case 'peer_found': {
          const id = normalizeNodeId(event.id);
          upsertContact(id, true, event.ageMs ?? 0);
          if (!event.ageMs) {
            setStatusInfo(`Node ${id} discovered (rssi=${event.rssi?.toFixed(0) ?? '?'} dBm)`);
          }
          break;
        }

        case 'msg_rx': {
          const from = normalizeNodeId(event.from);
          const raw = String(event.data ?? '');
          const isEnc = Boolean(event.encrypted);
          const isBroadcast = Boolean(event.broadcast);
          upsertContact(from, true, 0);

          const firmwareNoKey = isEnc && raw.startsWith('<encrypted:');
          const displayContent = firmwareNoKey
            ? '[Verschluesselung — Key fehlt]'
            : raw;

          const msg: Message = {
            id: crypto.randomUUID(),
            content: displayContent,
            sender: from,
            receiver: isBroadcast ? PUBLIC_CHANNEL_ID : 'me',
            timestamp: new Date(),
            status: 'delivered',
            via: 'radio',
            encrypted: isEnc && !firmwareNoKey,
          };

          if (isBroadcast) {
            // Broadcast → public channel
            appendMessage(PUBLIC_CHANNEL_ID, msg);
          } else {
            // Direct message → sender's contact
            appendMessage(from, msg);
          }
          break;
        }

        case 'scan_started':
          setStatusInfo('Scan gesendet — warte auf Antworten…');
          break;

        case 'key_saved':
          setPeerKeyStatus(`Firmware-Key für Node ${event.nodeId} gespeichert`);
          setStatusInfo(`Peer-Key für Node ${event.nodeId} in Firmware gespeichert`);
          break;

        case 'key_deleted':
          setPeerKeyStatus(`Key für Node ${event.nodeId} gelöscht`);
          break;

        case 'weather_rx':
          setStatusInfo(`Wetterdaten von Node ${event.from}: ${event.data}`);
          break;

        case 'settings':
          setDeviceSettings({
            batteryV: event.batteryV,
            batteryPct: event.batteryPct,
            loraPower: event.loraPower,
            maxHops: event.maxHops,
            reliableSend: event.reliableSend,
            sleepMode: event.sleepMode,
            weatherMode: event.weatherMode,
            loraFreq: event.loraFreq,
            loraSF: event.loraSF,
          });
          break;

        case 'battery':
          setDeviceSettings(prev => ({
            ...prev,
            batteryV: event.voltage,
            batteryPct: event.percent,
          }));
          break;

        case 'traceroute':
          setStatusInfo(`Traceroute zu 0x${event.target}: ${event.route}`);
          break;

        case 'ack_received':
          // Could be used to update message status — for now just info
          break;

        // Legacy firmware events
        case 'mesh_key_rx':
          setStatusInfo(`Mesh-Key von Node ${event.from} empfangen`);
          break;
        case 'msg_tx_err':
        case 'radio_not_ready':
          setStatusInfo('Nachricht konnte nicht gesendet werden');
          break;
      }
    });

    const removeDisconnect = commandService.addDisconnectListener(() => {
      setStatusInfo(
        connectionType === 'usb' ? 'USB-Verbindung getrennt' : 'Bluetooth-Verbindung getrennt',
      );
    });

    if (commandService.isConnected()) {
      commandService.sendCommand('/stations').catch(() => {});
      commandService.sendCommand('/settings').catch(() => {});

      // Sync stored keys to firmware on connect so encryption works immediately
      const storedKey = localStorage.getItem(LS_MY_KEY);
      if (storedKey && isValidKeyHex(storedKey)) {
        commandService.sendCommand(`/mykey set ${storedKey}`).catch(() => {});
      }
      const peerKeysMap = loadPeerKeys();
      peerKeysMap.forEach((key, nodeId) => {
        commandService.sendCommand(`/key set 0x${nodeId} ${key}`).catch(() => {});
      });
    }

    const interval = setInterval(() => {
      if (commandService.isConnected()) {
        commandService.sendCommand('/stations').catch(() => {});
        commandService.sendCommand('/settings').catch(() => {});
      }
    }, 20000);

    return () => {
      removeEvent();
      removeDisconnect();
      clearInterval(interval);
    };
  }, [commandService, connectionType]);

  const handleLogout = () => {
    localStorage.removeItem('nodeId');
    localStorage.removeItem('connectionType');
    logout();
  };

  const handleDisconnect = () => {
    if (connectionType === 'usb') {
      serialService.disconnect().catch(() => {});
    } else {
      bluetoothService.disconnect().catch(() => {});
    }
    localStorage.removeItem('nodeId');
    localStorage.removeItem('connectionType');
    navigate('/connect');
  };

  const handleScanNodes = async () => {
    setIsBusy(true);
    try {
      await commandService.sendCommand('/scan');
      setStatusInfo('Scan gestartet…');
    } catch (error) {
      setStatusInfo(`Scan fehlgeschlagen: ${(error as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleRefreshPeers = async () => {
    setIsBusy(true);
    try {
      await commandService.sendCommand('/stations');
    } catch (error) {
      setStatusInfo(`Stationen laden fehlgeschlagen: ${(error as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleAddContact = (rawId: string) => {
    const id = normalizeNodeId(rawId);
    if (!id) return;
    upsertContact(id, false);
  };

  /**
   * Generate a new AES-128 key using browser Web Crypto (secure random).
   * Stored in localStorage so it survives page refresh.
   * Also pushed to firmware via /mykey set so that firmware can encrypt with it.
   */
  const handleGenerateMyKey = async () => {
    const newKey = generateKeyHex();
    const currentNodeId = localStorage.getItem('nodeId') ?? myKeyNodeId;
    setMyKey(newKey);
    setMyKeyNodeId(currentNodeId);
    localStorage.setItem(LS_MY_KEY, newKey);

    // Sync to firmware so it uses the same key for /eto encryption
    try {
      await commandService.sendCommand(`/mykey set ${newKey}`);
    } catch {
      // Non-fatal — key is stored locally
    }

    setStatusInfo(`Neuer AES-128 Key generiert und an Firmware gesendet (Node 0x${currentNodeId})`);
  };

  /**
   * Store a peer's AES-128 key in browser state + localStorage.
   * Also forwards it to firmware (/key set) so firmware can decrypt
   * incoming encrypted messages from that peer.
   */
  const handleAddPeerKey = async (peerNodeId: string, key: string) => {
    const normalId = normalizeNodeId(peerNodeId.replace(/^0x/i, ''));
    const upperKey = key.toUpperCase().replace(/^0X/i, '');

    if (!isValidKeyHex(upperKey)) {
      setStatusInfo('Ungültiger Key — muss genau 32 HEX-Zeichen haben (AES-128)');
      return;
    }

    // Store in browser
    setWebPeerKeys(prev => {
      const next = new Map(prev);
      next.set(normalId, upperKey);
      savePeerKeys(next);
      return next;
    });

    // Sync to firmware for AES-128-CTR decryption of incoming messages
    const hexId = `0x${normalId}`;
    try {
      await commandService.sendCommand(`/key set ${hexId} ${upperKey}`);
    } catch {
      // Non-fatal
    }

    setPeerKeyStatus(`AES-128 Key für Node ${hexId} gespeichert`);
    setStatusInfo(`AES-128 Key für Node ${hexId} gespeichert (Browser + Firmware)`);
  };

  const handleDeletePeerKey = async (peerNodeId: string) => {
    const normalId = normalizeNodeId(peerNodeId.replace(/^0x/i, ''));

    setWebPeerKeys(prev => {
      const next = new Map(prev);
      next.delete(normalId);
      savePeerKeys(next);
      return next;
    });

    const hexId = `0x${normalId}`;
    try {
      await commandService.sendCommand(`/key del ${hexId}`);
    } catch {
      // Non-fatal
    }

    setPeerKeyStatus(`Key für Node ${hexId} gelöscht`);
    setStatusInfo(`Key für Node ${hexId} gelöscht (Browser + Firmware)`);
  };

  const handleSendMessage = async (recipient: string, content: string) => {
    const optimisticId = crypto.randomUUID();
    const normalRecipient = normalizeNodeId(recipient);
    const isPublic = normalRecipient === PUBLIC_CHANNEL_ID;
    const hexId = normalRecipient;

    appendMessage(normalRecipient, {
      id: optimisticId,
      content,
      sender: 'me',
      receiver: normalRecipient,
      timestamp: new Date(),
      status: 'pending',
      via: 'radio',
      encrypted: isPublic || Boolean(myKey),
    });

    try {
      let command: string;
      if (isPublic) {
        // Public channel — broadcast encrypted with standard key
        command = `/pub ${content}`;
      } else if (myKey && /^[0-9a-fA-F]+$/.test(hexId)) {
        // Encrypted direct message
        command = `/eto 0x${hexId} ${content}`;
      } else if (/^[0-9a-fA-F]+$/.test(hexId)) {
        // Unencrypted direct message
        command = `/msg 0x${hexId} ${content}`;
      } else {
        command = content;
      }

      await commandService.sendCommand(command);

      setMessagesByContact(prev => ({
        ...prev,
        [normalRecipient]: (prev[normalRecipient] ?? []).map(msg =>
          msg.id === optimisticId ? { ...msg, status: 'sent' } : msg,
        ),
      }));
    } catch {
      setMessagesByContact(prev => ({
        ...prev,
        [normalRecipient]: (prev[normalRecipient] ?? []).map(msg =>
          msg.id === optimisticId ? { ...msg, status: 'failed' } : msg,
        ),
      }));
      setStatusInfo('Nachricht konnte nicht gesendet werden');
    }
  };

  const selectedMessages = useMemo(
    () => (selectedContact ? messagesByContact[selectedContact] ?? [] : []),
    [selectedContact, messagesByContact],
  );

  const selectedIsPublic = selectedContact === PUBLIC_CHANNEL_ID;
  const selectedHasPeerKey = selectedContact
    ? webPeerKeys.has(normalizeNodeId(selectedContact))
    : false;

  const canSendEncrypted = Boolean(myKey);
  const bothEncrypted = canSendEncrypted && selectedHasPeerKey;

  return (
    <div className="flex h-screen flex-col bg-gray-800">
      <header className="bg-gray-900 shadow">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-100">MegaMesh</h1>
              <p className="text-sm text-gray-400">Willkommen, {user?.username}</p>
              {statusInfo && <p className="mt-1 text-xs text-primary-700">{statusInfo}</p>}
            </div>
            <div className="flex items-center space-x-4">
              {nodeId && (
                <div className="text-sm text-gray-400">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-green-500" />
                  Node: <span className="font-mono text-xs">0x{nodeId}</span>
                  <span className="ml-2 text-xs">({connectionType === 'usb' ? 'USB' : 'BT'})</span>
                </div>
              )}
              {deviceSettings?.batteryPct !== undefined && (
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <span>{deviceSettings.batteryPct}%</span>
                  <div className="relative h-3 w-6 rounded-sm border border-gray-500">
                    <div
                      className={`absolute inset-0.5 rounded-[1px] ${
                        deviceSettings.batteryPct > 50
                          ? 'bg-green-500'
                          : deviceSettings.batteryPct > 20
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.min(100, deviceSettings.batteryPct)}%` }}
                    />
                  </div>
                  {deviceSettings.batteryV !== undefined && (
                    <span className="text-gray-500">{deviceSettings.batteryV.toFixed(1)}V</span>
                  )}
                </div>
              )}
              <button
                onClick={() => setShowSettings(s => !s)}
                className="rounded-md bg-gray-700 px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-600"
                title="Geräte-Einstellungen"
              >
                ⚙
              </button>
              <Link
                to="/weather"
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Wetterkarte
              </Link>
              <button
                onClick={handleDisconnect}
                className="rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-600"
              >
                Node trennen
              </button>
              <button
                onClick={handleLogout}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Abmelden
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Device Settings Panel */}
      {showSettings && (
        <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
          <div className="rounded-lg bg-gray-900 p-4 shadow">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-200">Geräte-Einstellungen</h3>
              <button
                onClick={() => {
                  commandService.sendCommand('/settings').catch(() => {});
                }}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Aktualisieren
              </button>
            </div>
            {deviceSettings ? (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
                <div className="text-gray-400">
                  TX Power: <span className="text-gray-200">{deviceSettings.loraPower} dBm</span>
                </div>
                <div className="text-gray-400">
                  Max Hops: <span className="text-gray-200">{deviceSettings.maxHops}</span>
                </div>
                <div className="text-gray-400">
                  Frequenz: <span className="text-gray-200">{deviceSettings.loraFreq} MHz</span>
                </div>
                <div className="text-gray-400">
                  SF: <span className="text-gray-200">{deviceSettings.loraSF}</span>
                </div>
                <div className="text-gray-400">
                  Reliable Send:{' '}
                  <span className={deviceSettings.reliableSend ? 'text-green-400' : 'text-gray-500'}>
                    {deviceSettings.reliableSend ? 'ON' : 'OFF'}
                  </span>
                </div>
                <div className="text-gray-400">
                  Sleep:{' '}
                  <span className={deviceSettings.sleepMode ? 'text-green-400' : 'text-gray-500'}>
                    {deviceSettings.sleepMode ? 'ON' : 'OFF'}
                  </span>
                </div>
                <div className="text-gray-400">
                  Wetter:{' '}
                  <span className={deviceSettings.weatherMode ? 'text-green-400' : 'text-gray-500'}>
                    {deviceSettings.weatherMode ? 'ON' : 'OFF'}
                  </span>
                </div>
                <div className="text-gray-400">
                  Batterie:{' '}
                  <span className="text-gray-200">
                    {deviceSettings.batteryPct}% ({deviceSettings.batteryV?.toFixed(2)}V)
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500">Lade Einstellungen…</p>
            )}
            {/* Quick controls */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => commandService.sendCommand('/battery').catch(() => {})}
                className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600"
              >
                Batterie
              </button>
              <button
                onClick={() => {
                  const val = deviceSettings?.reliableSend ? 'off' : 'on';
                  commandService.sendCommand(`/reliable ${val}`).catch(() => {});
                  setDeviceSettings(prev => prev ? { ...prev, reliableSend: !prev.reliableSend } : prev);
                }}
                className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600"
              >
                Reliable {deviceSettings?.reliableSend ? 'aus' : 'ein'}
              </button>
              <button
                onClick={() => {
                  const val = deviceSettings?.sleepMode ? 'off' : 'on';
                  commandService.sendCommand(`/sleep ${val}`).catch(() => {});
                  setDeviceSettings(prev => prev ? { ...prev, sleepMode: !prev.sleepMode } : prev);
                }}
                className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600"
              >
                Sleep {deviceSettings?.sleepMode ? 'aus' : 'ein'}
              </button>
              <button
                onClick={() => {
                  const val = deviceSettings?.weatherMode ? 'off' : 'on';
                  commandService.sendCommand(`/wx ${val}`).catch(() => {});
                  setDeviceSettings(prev => prev ? { ...prev, weatherMode: !prev.weatherMode } : prev);
                }}
                className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600"
              >
                Wetter {deviceSettings?.weatherMode ? 'aus' : 'ein'}
              </button>
              <button
                onClick={() => commandService.sendCommand('/save').catch(() => {})}
                className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600"
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-7xl flex-1 overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
        <div className="mr-4 flex w-[22rem] flex-col rounded-lg bg-gray-900 shadow">
          <ContactList
            selectedContact={selectedContact}
            onSelectContact={setSelectedContact}
            contacts={contacts}
            onScanNodes={handleScanNodes}
            onRefreshPeers={handleRefreshPeers}
            onAddContact={handleAddContact}
            myKey={myKey}
            myKeyNodeId={myKeyNodeId}
            onGenerateMyKey={handleGenerateMyKey}
            onAddPeerKey={handleAddPeerKey}
            onDeletePeerKey={handleDeletePeerKey}
            peerKeys={webPeerKeys}
            peerKeyStatus={peerKeyStatus}
            isBusy={isBusy}
          />
        </div>

        <div className="flex flex-1 flex-col overflow-hidden rounded-lg bg-gray-900 shadow">
          {selectedContact ? (
            <>
              <div className="border-b bg-gray-800 px-4 py-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-gray-100">
                    {selectedIsPublic ? 'Oeffentlicher Kanal' : `Node 0x${selectedContact}`}
                  </h3>
                  <div className="flex items-center gap-2">
                    {!selectedIsPublic && (
                      <button
                        onClick={() => {
                          commandService.sendCommand(`/traceroute 0x${selectedContact}`).catch(() => {});
                          setStatusInfo(`Traceroute zu 0x${selectedContact} gestartet…`);
                        }}
                        className="rounded px-2 py-0.5 text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600"
                        title="Route zum Node anzeigen"
                      >
                        Traceroute
                      </button>
                    )}
                    <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      selectedIsPublic
                        ? 'bg-blue-900/30 text-blue-400'
                        : bothEncrypted
                          ? 'bg-green-900/30 text-green-400'
                          : canSendEncrypted || selectedHasPeerKey
                            ? 'bg-yellow-900/30 text-yellow-400'
                            : 'bg-gray-800 text-gray-400'
                    }`}
                  >
                    {selectedIsPublic
                      ? 'Standard-Key'
                      : bothEncrypted
                        ? 'Verschluesselt'
                        : canSendEncrypted
                          ? 'Senden verschluesselt'
                          : selectedHasPeerKey
                            ? 'Empfang verschluesselt'
                            : 'Unverschluesselt'}
                  </span>
                  </div>
                </div>
                {selectedIsPublic && (
                  <p className="mt-0.5 text-[11px] text-blue-600">
                    Alle Nodes koennen hier mitlesen (Standard-Key).
                  </p>
                )}
              </div>
              <MessageList messages={selectedMessages} />
              <MessageInput
                recipient={selectedContact}
                onSendMessage={handleSendMessage}
                disabled={isBusy}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-gray-400">
              Node oder Kanal auswaehlen
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
