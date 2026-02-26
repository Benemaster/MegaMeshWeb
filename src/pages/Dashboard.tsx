import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageList } from '../components/MessageList';
import { MessageInput } from '../components/MessageInput';
import { ContactList, type MeshContact } from '../components/ContactList';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { bluetoothService } from '../services/bluetoothService';
import { serialService } from '../services/serialService';
import type { BluetoothEvent } from '../types/bluetooth';
import type { Message } from '../types/messaging';
import {
  generateKeyHex,
  encryptMessage,
  decryptMessage,
  isEncryptedMessage,
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
          upsertContact(from, true, 0);

          // AES-128-GCM decryption if message is encrypted and we have the sender's key
          if (isEncryptedMessage(raw)) {
            const peerKey = webPeerKeysRef.current.get(from);
            (async () => {
              let displayContent: string;
              let decrypted = false;
              if (peerKey) {
                const plain = await decryptMessage(raw, peerKey);
                if (plain !== null) {
                  displayContent = plain;
                  decrypted = true;
                } else {
                  displayContent = '[AES-128 Entschlüsselung fehlgeschlagen — falscher Key?]';
                }
              } else {
                displayContent = '[AES-128 verschlüsselt — kein Key für diesen Sender]';
              }
              appendMessage(from, {
                id: crypto.randomUUID(),
                content: displayContent,
                sender: from,
                receiver: 'me',
                timestamp: new Date(),
                status: 'delivered',
                via: 'radio',
                encrypted: decrypted,
              });
            })();
          } else {
            appendMessage(from, {
              id: crypto.randomUUID(),
              content: raw,
              sender: from,
              receiver: 'me',
              timestamp: new Date(),
              status: 'delivered',
              via: 'radio',
            });
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
    }

    const interval = setInterval(() => {
      if (commandService.isConnected()) {
        commandService.sendCommand('/stations').catch(() => {});
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
   * Does NOT call the firmware — the key lives in the browser.
   */
  const handleGenerateMyKey = () => {
    const newKey = generateKeyHex();
    const currentNodeId = localStorage.getItem('nodeId') ?? myKeyNodeId;
    setMyKey(newKey);
    setMyKeyNodeId(currentNodeId);
    localStorage.setItem(LS_MY_KEY, newKey);
    setStatusInfo(`Neuer AES-128 Key generiert für Node 0x${currentNodeId}`);
  };

  /**
   * Store a peer's AES-128 key in browser state + localStorage.
   * Also optionally forwards it to firmware (/key set) so that the legacy
   * firmware XOR cipher can still be used if needed.
   */
  const handleAddPeerKey = async (peerNodeId: string, key: string) => {
    const normalId = normalizeNodeId(peerNodeId.replace(/^0x/i, ''));
    const upperKey = key.toUpperCase().replace(/^0X/i, '');

    if (!isValidKeyHex(upperKey)) {
      setStatusInfo('Ungültiger Key — muss genau 32 HEX-Zeichen haben (AES-128)');
      return;
    }

    // Store in browser for AES-128 decryption of incoming messages
    setWebPeerKeys(prev => {
      const next = new Map(prev);
      next.set(normalId, upperKey);
      savePeerKeys(next);
      return next;
    });

    // Also forward to firmware for legacy /eto support
    const hexId = `0x${normalId}`;
    try {
      await commandService.sendCommand(`/key set ${hexId} ${upperKey}`);
    } catch {
      // Non-fatal — web-layer AES-128 still works without firmware key
    }

    setPeerKeyStatus(`AES-128 Key für Node ${hexId} gespeichert`);
    setStatusInfo(`AES-128 Key für Node ${hexId} gespeichert (Browser + Firmware)`);
  };

  const handleSendMessage = async (recipient: string, content: string) => {
    const optimisticId = crypto.randomUUID();
    const normalRecipient = normalizeNodeId(recipient);
    const hexId = normalRecipient;

    // Encrypt with OWN key (myKey), not the recipient's key.
    // The recipient decrypts with the sender's key they stored via QR-code exchange.
    // This matches the firmware model: sender encrypts with personalKey,
    // recipient decrypts using the stored key for that sender node.
    appendMessage(normalRecipient, {
      id: optimisticId,
      content,
      sender: 'me',
      receiver: normalRecipient,
      timestamp: new Date(),
      status: 'pending',
      via: 'radio',
      encrypted: Boolean(myKey),
    });

    try {
      let command: string;
      if (myKey) {
        // AES-128-GCM encrypt with own key; recipient needs our key stored to decrypt
        const cipher = await encryptMessage(content, myKey);
        command = cipher; // firmware relays opaque ciphertext
      } else if (/^[0-9a-fA-F]+$/.test(hexId)) {
        // Fallback: firmware-level /eto (AES-128-CTR) when no web-layer key exists
        command = `/eto 0x${hexId} ${content}`;
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

  const selectedHasPeerKey = selectedContact
    ? webPeerKeys.has(normalizeNodeId(selectedContact))
    : false;

  // Can send encrypted: we have our own key
  // Can receive encrypted: we have the sender's key stored
  const canSendEncrypted = Boolean(myKey);
  const bothEncrypted = canSendEncrypted && selectedHasPeerKey;

  return (
    <div className="flex h-screen flex-col bg-gray-100">
      <header className="bg-white shadow">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">MegaMesh</h1>
              <p className="text-sm text-gray-600">Willkommen, {user?.username}</p>
              {statusInfo && <p className="mt-1 text-xs text-primary-700">{statusInfo}</p>}
            </div>
            <div className="flex items-center space-x-4">
              {nodeId && (
                <div className="text-sm text-gray-600">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-green-500" />
                  Node: <span className="font-mono text-xs">0x{nodeId}</span>
                  <span className="ml-2 text-xs">({connectionType === 'usb' ? 'USB' : 'BT'})</span>
                </div>
              )}
              <button
                onClick={handleDisconnect}
                className="rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
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

      <div className="mx-auto flex w-full max-w-7xl flex-1 overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
        <div className="mr-4 flex w-[22rem] flex-col rounded-lg bg-white shadow">
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
            peerKeyStatus={peerKeyStatus}
            isBusy={isBusy}
          />
        </div>

        <div className="flex flex-1 flex-col overflow-hidden rounded-lg bg-white shadow">
          {selectedContact ? (
            <>
              <div className="border-b bg-gray-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-gray-900">Node 0x{selectedContact}</h3>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      bothEncrypted
                        ? 'bg-green-100 text-green-700'
                        : canSendEncrypted || selectedHasPeerKey
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {bothEncrypted
                      ? 'AES-128 aktiv'
                      : canSendEncrypted
                        ? 'Nur Senden verschlüsselt'
                        : selectedHasPeerKey
                          ? 'Nur Empfang verschlüsselt'
                          : 'Unverschlüsselt'}
                  </span>
                </div>
                {!canSendEncrypted && (
                  <p className="mt-0.5 text-[11px] text-amber-600">
                    Kein eigener Key — ausgehende Nachrichten werden unverschlüsselt gesendet.
                  </p>
                )}
                {canSendEncrypted && !selectedHasPeerKey && (
                  <p className="mt-0.5 text-[11px] text-amber-600">
                    Kein Key für diesen Kontakt gespeichert — eingehende Nachrichten können nicht entschlüsselt werden.
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
            <div className="flex flex-1 items-center justify-center text-gray-500">
              Wähle eine Node aus, um Nachrichten zu senden
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
