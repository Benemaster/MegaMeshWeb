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
    <div className="mesh-bg flex h-screen flex-col bg-surface">
      {/* Subtle ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-60 left-0 h-[300px] w-[300px] rounded-full bg-primary-600/5 blur-[100px]" />
        <div className="absolute -bottom-60 right-0 h-[250px] w-[250px] rounded-full bg-cyber-500/5 blur-[100px]" />
      </div>

      <header className="relative z-10 border-b border-white/5 bg-surface-50/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-cyber-500">
                <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">MegaMesh</h1>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{user?.username}</span>
                  {statusInfo && (
                    <>
                      <span className="text-white/10">|</span>
                      <span className="text-primary-400/80">{statusInfo}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {nodeId && (
                <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-surface-200/50 px-3 py-1.5 text-xs">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                  </span>
                  <span className="font-mono text-gray-400">0x{nodeId}</span>
                  <span className="text-gray-600">{connectionType === 'usb' ? 'USB' : 'BT'}</span>
                </div>
              )}
              {deviceSettings?.batteryPct !== undefined && (
                <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-surface-200/50 px-3 py-1.5 text-xs text-gray-400">
                  <span>{deviceSettings.batteryPct}%</span>
                  <div className="relative h-3 w-6 overflow-hidden rounded-sm border border-white/10">
                    <div
                      className={`absolute inset-0 rounded-[1px] ${
                        deviceSettings.batteryPct > 50
                          ? 'bg-green-500/60'
                          : deviceSettings.batteryPct > 20
                            ? 'bg-yellow-500/60'
                            : 'bg-red-500/60'
                      }`}
                      style={{ width: `${Math.min(100, deviceSettings.batteryPct)}%` }}
                    />
                  </div>
                </div>
              )}
              <button
                onClick={() => setShowSettings(s => !s)}
                className="rounded-lg border border-white/5 bg-surface-200/50 p-2 text-gray-400 transition-colors hover:border-white/10 hover:text-white"
                title="Geraete-Einstellungen"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <Link
                to="/weather"
                className="rounded-lg border border-white/5 bg-surface-200/50 p-2 text-gray-400 transition-colors hover:border-primary-500/20 hover:text-primary-400"
                title="Wetterkarte"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
                </svg>
              </Link>
              <button
                onClick={handleDisconnect}
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                Trennen
              </button>
              <button
                onClick={handleLogout}
                className="btn-danger px-3 py-1.5 text-xs"
              >
                Abmelden
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Device Settings Panel */}
      {showSettings && (
        <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 lg:px-8 animate-fade-in">
          <div className="glass-card glow-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Geraete-Einstellungen</h3>
              <button
                onClick={() => {
                  commandService.sendCommand('/settings').catch(() => {});
                }}
                className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
              >
                Aktualisieren
              </button>
            </div>
            {deviceSettings ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'TX Power', value: `${deviceSettings.loraPower} dBm` },
                  { label: 'Max Hops', value: deviceSettings.maxHops },
                  { label: 'Frequenz', value: `${deviceSettings.loraFreq} MHz` },
                  { label: 'SF', value: deviceSettings.loraSF },
                  { label: 'Reliable Send', value: deviceSettings.reliableSend ? 'ON' : 'OFF', on: deviceSettings.reliableSend },
                  { label: 'Sleep', value: deviceSettings.sleepMode ? 'ON' : 'OFF', on: deviceSettings.sleepMode },
                  { label: 'Wetter', value: deviceSettings.weatherMode ? 'ON' : 'OFF', on: deviceSettings.weatherMode },
                  { label: 'Batterie', value: `${deviceSettings.batteryPct}% (${deviceSettings.batteryV?.toFixed(2)}V)` },
                ].map((item, i) => (
                  <div key={i} className="rounded-lg border border-white/5 bg-surface-200/50 px-3 py-2">
                    <p className="text-[10px] text-gray-500">{item.label}</p>
                    <p className={`text-sm font-medium ${
                      item.on !== undefined
                        ? item.on ? 'text-green-400' : 'text-gray-500'
                        : 'text-gray-200'
                    }`}>{item.value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500">Lade Einstellungen…</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                { label: 'Batterie', cmd: '/battery' },
                { label: `Reliable ${deviceSettings?.reliableSend ? 'aus' : 'ein'}`, cmd: `/reliable ${deviceSettings?.reliableSend ? 'off' : 'on'}`, toggle: 'reliableSend' },
                { label: `Sleep ${deviceSettings?.sleepMode ? 'aus' : 'ein'}`, cmd: `/sleep ${deviceSettings?.sleepMode ? 'off' : 'on'}`, toggle: 'sleepMode' },
                { label: `Wetter ${deviceSettings?.weatherMode ? 'aus' : 'ein'}`, cmd: `/wx ${deviceSettings?.weatherMode ? 'off' : 'on'}`, toggle: 'weatherMode' },
                { label: 'Speichern', cmd: '/save' },
              ].map((btn) => (
                <button
                  key={btn.label}
                  onClick={() => {
                    commandService.sendCommand(btn.cmd).catch(() => {});
                    if (btn.toggle) {
                      setDeviceSettings(prev => prev ? { ...prev, [btn.toggle!]: !prev[btn.toggle as keyof typeof prev] } : prev);
                    }
                  }}
                  className="rounded-lg border border-white/5 bg-surface-300/50 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-primary-500/20 hover:text-white"
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 overflow-hidden px-4 py-4 sm:px-6 lg:px-8 gap-4">
        {/* Sidebar */}
        <div className="flex w-[22rem] flex-col glass-card glow-border overflow-hidden">
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

        {/* Chat area */}
        <div className="flex flex-1 flex-col overflow-hidden glass-card glow-border">
          {selectedContact ? (
            <>
              <div className="border-b border-white/5 bg-surface-100/50 px-5 py-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white">
                    {selectedIsPublic ? 'Oeffentlicher Kanal' : (
                      <span className="flex items-center gap-2">
                        Node <span className="font-mono text-primary-400">0x{selectedContact}</span>
                      </span>
                    )}
                  </h3>
                  <div className="flex items-center gap-2">
                    {!selectedIsPublic && (
                      <button
                        onClick={() => {
                          commandService.sendCommand(`/traceroute 0x${selectedContact}`).catch(() => {});
                          setStatusInfo(`Traceroute zu 0x${selectedContact} gestartet…`);
                        }}
                        className="rounded-lg border border-white/5 bg-surface-300/50 px-2.5 py-1 text-xs text-gray-400 transition-colors hover:border-primary-500/20 hover:text-primary-300"
                        title="Route zum Node anzeigen"
                      >
                        Traceroute
                      </button>
                    )}
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${
                        selectedIsPublic
                          ? 'bg-primary-500/10 text-primary-400 ring-primary-500/20'
                          : bothEncrypted
                            ? 'bg-green-500/10 text-green-400 ring-green-500/20'
                            : canSendEncrypted || selectedHasPeerKey
                              ? 'bg-yellow-500/10 text-yellow-400 ring-yellow-500/20'
                              : 'bg-surface-300 text-gray-500 ring-white/10'
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
                  <p className="mt-1 text-[11px] text-primary-500/60">
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
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-gray-500">
              <svg className="h-12 w-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
              <p className="text-sm">Node oder Kanal auswaehlen</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
