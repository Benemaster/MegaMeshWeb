import { useEffect, useMemo, useState } from 'react';
import { MessageList } from '../components/MessageList';
import { MessageInput } from '../components/MessageInput';
import { ContactList, type MeshContact } from '../components/ContactList';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { bluetoothService } from '../services/bluetoothService';
import { serialService } from '../services/serialService';
import type { BluetoothEvent } from '../types/bluetooth';
import type { Message } from '../types/messaging';

const normalizeNodeId = (value: string | number): string => String(value).trim();

const toNodeNumber = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return null;
};

export const Dashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [contacts, setContacts] = useState<MeshContact[]>([]);
  const [messagesByContact, setMessagesByContact] = useState<Record<string, Message[]>>({});
  const [networkKey, setNetworkKey] = useState('');
  const [statusInfo, setStatusInfo] = useState('');
  const [isBusy, setIsBusy] = useState(false);

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
          item.id === id
            ? {
                ...item,
                isOnline: isOnline || item.isOnline,
                lastSeenMs,
              }
            : item,
        );
      }
      return [{ id, name: `Node ${id}`, isOnline, lastSeenMs }, ...prev];
    });
  };

  useEffect(() => {
    const removeEvent = commandService.addEventListener((event: BluetoothEvent) => {
      switch (event.evt) {
        case 'peer_found': {
          const id = normalizeNodeId(event.id);
          upsertContact(id, true, 0);
          setStatusInfo(`Node ${id} gefunden`);
          break;
        }
        case 'peers': {
          const items = Array.isArray(event.items) ? event.items : [];
          for (const item of items) {
            const id = normalizeNodeId(item.id);
            upsertContact(id, true, Number(item.ageMs ?? 0));
          }
          setStatusInfo(`${items.length} Peer(s) aktualisiert`);
          break;
        }
        case 'msg_rx': {
          const from = normalizeNodeId(event.from);
          upsertContact(from, true, 0);
          appendMessage(from, {
            id: crypto.randomUUID(),
            content: String(event.data ?? ''),
            sender: from,
            receiver: 'me',
            timestamp: new Date(),
            status: 'delivered',
            via: 'radio',
          });
          break;
        }
        case 'mesh_key':
          if (typeof event.v === 'string') {
            setNetworkKey(event.v.toUpperCase());
            setStatusInfo('Mesh-Key aktualisiert');
          }
          break;
        case 'mesh_key_rx':
          if (typeof event.v === 'string') {
            setNetworkKey(event.v.toUpperCase());
          }
          setStatusInfo(`Mesh-Key von Node ${event.from} empfangen`);
          break;
        case 'mesh_key_ack':
          setStatusInfo(`Node ${event.from} hat den Key bestätigt`);
          break;
        case 'mesh_key_tx':
          setStatusInfo(`Key an Node ${event.dst} gesendet`);
          break;
        case 'mesh_key_tx_err':
          setStatusInfo(`Key-Senden zu Node ${event.dst} fehlgeschlagen`);
          break;
        case 'msg_tx_err':
          setStatusInfo('Nachricht konnte nicht gesendet werden');
          break;
        case 'radio_not_ready':
          setStatusInfo('Funk ist noch nicht bereit. Bitte erst initialisieren und Mesh starten.');
          break;
      }
    });

    const removeDisconnect = commandService.addDisconnectListener(() => {
      setStatusInfo(connectionType === 'usb' ? 'USB-Verbindung getrennt' : 'Bluetooth-Verbindung getrennt');
    });

    if (commandService.isConnected()) {
      commandService.sendCommand('mesh peers').catch(() => {});
      commandService.sendCommand('mesh key').catch(() => {});
    }

    const interval = setInterval(() => {
      if (commandService.isConnected()) {
        commandService.sendCommand('mesh peers').catch(() => {});
      }
    }, 15000);

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
      await commandService.sendCommand('mesh scan');
      setStatusInfo('Node-Scan gestartet');
    } catch (error) {
      setStatusInfo(`Scan fehlgeschlagen: ${(error as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleRefreshPeers = async () => {
    setIsBusy(true);
    try {
      await commandService.sendCommand('mesh peers');
    } catch (error) {
      setStatusInfo(`Peers laden fehlgeschlagen: ${(error as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleAddContact = (rawId: string) => {
    const id = normalizeNodeId(rawId);
    if (!id) return;
    upsertContact(id, false);
    setStatusInfo(`Node ${id} hinzugefügt`);
  };

  const handleApplyNetworkKey = async () => {
    const key = networkKey.trim().toUpperCase();
    if (!/^[0-9A-F]{32}$/.test(key)) {
      setStatusInfo('Key muss 32 HEX-Zeichen haben');
      return;
    }

    setIsBusy(true);
    try {
      await commandService.sendCommand(`mesh key ${key}`);
      setStatusInfo('Mesh-Key gesetzt');
    } catch (error) {
      setStatusInfo(`Key setzen fehlgeschlagen: ${(error as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleGenerateNetworkKey = async () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const generated = Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();

    setNetworkKey(generated);

    setIsBusy(true);
    try {
      await commandService.sendCommand(`mesh key ${generated}`);
      setStatusInfo('Neuer Mesh-Key erzeugt und gesetzt');
    } catch (error) {
      setStatusInfo(`Key setzen fehlgeschlagen: ${(error as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSendKeyToSelected = async () => {
    if (!selectedContact) return;

    const nodeNumber = toNodeNumber(selectedContact);
    if (nodeNumber === null) {
      setStatusInfo('Für Key-Transfer ist eine numerische Node-ID erforderlich');
      return;
    }

    setIsBusy(true);
    try {
      await commandService.sendCommand(`mesh keysend ${nodeNumber}`);
    } catch (error) {
      setStatusInfo(`Key-Senden fehlgeschlagen: ${(error as Error).message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSendMessage = async (recipient: string, content: string) => {
    const nodeNumber = toNodeNumber(recipient);
    if (nodeNumber === null) {
      setStatusInfo('Empfänger muss eine numerische Node-ID sein');
      return;
    }

    const optimisticId = crypto.randomUUID();
    appendMessage(recipient, {
      id: optimisticId,
      content,
      sender: 'me',
      receiver: recipient,
      timestamp: new Date(),
      status: 'pending',
      via: 'radio',
    });

    try {
      await commandService.sendCommand(`sendto ${nodeNumber} ${content}`);
      setMessagesByContact(prev => ({
        ...prev,
        [recipient]: (prev[recipient] ?? []).map(message =>
          message.id === optimisticId ? { ...message, status: 'sent' } : message,
        ),
      }));
    } catch {
      setMessagesByContact(prev => ({
        ...prev,
        [recipient]: (prev[recipient] ?? []).map(message =>
          message.id === optimisticId ? { ...message, status: 'failed' } : message,
        ),
      }));
      setStatusInfo('Nachricht konnte nicht gesendet werden');
    }
  };

  const selectedMessages = useMemo(
    () => (selectedContact ? messagesByContact[selectedContact] ?? [] : []),
    [selectedContact, messagesByContact],
  );

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
                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-green-500"></span>
                  Node: <span className="font-mono text-xs">{nodeId}</span>
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
            networkKey={networkKey}
            onNetworkKeyChange={setNetworkKey}
            onApplyNetworkKey={handleApplyNetworkKey}
            onGenerateNetworkKey={handleGenerateNetworkKey}
            onSendKeyToSelected={handleSendKeyToSelected}
            isBusy={isBusy}
          />
        </div>

        <div className="flex flex-1 flex-col overflow-hidden rounded-lg bg-white shadow">
          {selectedContact ? (
            <>
              <div className="border-b bg-gray-50 px-4 py-3">
                <h3 className="font-medium text-gray-900">Node {selectedContact}</h3>
              </div>
              <MessageList messages={selectedMessages} />
              <MessageInput recipient={selectedContact} onSendMessage={handleSendMessage} disabled={isBusy} />
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
