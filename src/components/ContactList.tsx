import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QrScanner } from './QrScanner';

export interface MeshContact {
  id: string;
  name: string;
  isOnline: boolean;
  lastSeenMs?: number;
}

interface ContactListProps {
  selectedContact: string | null;
  onSelectContact: (contactId: string) => void;
  contacts: MeshContact[];
  onScanNodes: () => void;
  onRefreshPeers: () => void;
  onAddContact: (contactId: string) => void;
  myKey: string;
  myKeyNodeId: string;
  onGenerateMyKey: () => void;
  onAddPeerKey: (nodeId: string, key: string) => void;
  onDeletePeerKey?: (nodeId: string) => void;
  peerKeys: Map<string, string>;
  peerKeyStatus?: string;
  isBusy?: boolean;
}

/** QR payload: MEGAMESH:0x<nodeId>:<key32hex> */
function buildQrPayload(nodeId: string, key: string): string {
  const id = nodeId.startsWith('0x') ? nodeId : `0x${nodeId}`;
  return `MEGAMESH:${id}:${key}`;
}

function parseQrPayload(raw: string): { nodeId: string; key: string } | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^MEGAMESH:(0x[0-9A-Fa-f]+):([0-9A-Fa-f]{32})$/i);
  if (match) return { nodeId: match[1], key: match[2].toUpperCase() };
  try {
    const obj = JSON.parse(trimmed);
    if (obj.id && obj.k && /^[0-9A-Fa-f]{32}$/.test(obj.k)) {
      return { nodeId: String(obj.id), key: String(obj.k).toUpperCase() };
    }
  } catch { /* not JSON */ }
  return null;
}

// -- Own Key Modal --

interface KeySettingsModalProps {
  myKey: string;
  myKeyNodeId: string;
  isBusy: boolean;
  onGenerate: () => void;
  onClose: () => void;
}

function KeySettingsModal({ myKey, myKeyNodeId, isBusy, onGenerate, onClose }: KeySettingsModalProps) {
  const [confirmed, setConfirmed] = useState(false);
  const hasKey = Boolean(myKey);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mx-4 w-full max-w-sm rounded-xl bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold text-gray-100">Eigener Key</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-700">x</button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className={`rounded-lg border p-3 ${hasKey ? 'border-green-800 bg-green-900/20' : 'border-gray-700 bg-gray-800'}`}>
            <p className={`text-xs font-semibold ${hasKey ? 'text-green-300' : 'text-gray-400'}`}>
              {hasKey ? 'Key aktiv' : 'Kein Key'}
            </p>
            {hasKey && (
              <>
                {myKeyNodeId && (
                  <p className="mt-1 font-mono text-[10px] text-green-400 break-all select-all">
                    {buildQrPayload(myKeyNodeId, myKey)}
                  </p>
                )}
                {!myKeyNodeId && (
                  <p className="mt-1 font-mono text-[10px] text-gray-400 break-all select-all">{myKey}</p>
                )}
              </>
            )}
          </div>
          {hasKey && (
            <div className="rounded-lg border border-red-800 bg-red-900/20 p-3">
              <p className="text-xs font-semibold text-red-300">Neuer Key</p>
              <p className="mt-1 text-[11px] text-red-400">
                Bei neuem Key muessen alle Kontakte den neuen Key uebernehmen.
              </p>
              <label className="mt-2 flex cursor-pointer items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-red-600" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span className="text-[11px] text-red-400">Verstanden</span>
              </label>
            </div>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 rounded-md border border-gray-600 bg-gray-900 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700">Abbrechen</button>
            <button type="button" disabled={isBusy || (hasKey && !confirmed)} onClick={() => { onGenerate(); onClose(); }} className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {hasKey ? 'Neuer Key' : 'Key erzeugen'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -- Per-Contact Key Modal --

interface PeerKeyModalProps {
  contactId: string;
  existingKey: string | null;
  onSave: (nodeId: string, key: string) => void;
  onDelete?: (nodeId: string) => void;
  onClose: () => void;
}

function PeerKeyModal({ contactId, existingKey, onSave, onDelete, onClose }: PeerKeyModalProps) {
  const [keyInput, setKeyInput] = useState(existingKey ?? '');
  const [error, setError] = useState('');

  const handleSave = () => {
    let raw = keyInput.trim();
    const megameshMatch = raw.match(/MEGAMESH:0x[0-9A-Fa-f]+:([0-9A-Fa-f]{32})/i);
    if (megameshMatch) raw = megameshMatch[1];
    const cleaned = raw.toUpperCase().replace(/^0X/i, '');
    if (!/^[0-9A-F]{32}$/.test(cleaned)) {
      setError('32 HEX-Zeichen oder MEGAMESH:0x...:KEY Format erwartet');
      return;
    }
    onSave(contactId, cleaned);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mx-4 w-full max-w-sm rounded-xl bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-100">Key fuer 0x{contactId}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-700">x</button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-[11px] text-gray-400">
            Key von 0x{contactId} hier einfuegen, um dessen Nachrichten zu lesen.
          </p>
          <input
            type="text"
            placeholder="MEGAMESH:0xABCD:... oder 32 HEX"
            value={keyInput}
            onChange={(e) => { setKeyInput(e.target.value); setError(''); }}
            className="w-full rounded-md border border-gray-600 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            maxLength={80}
            spellCheck={false}
          />
          {error && <p className="text-[11px] text-red-400">{error}</p>}
          {existingKey && (
            <p className="text-[11px] text-green-400 break-all">
              Aktuell: <span className="font-mono">{buildQrPayload(contactId, existingKey)}</span>
            </p>
          )}
          <div className="flex gap-2">
            {existingKey && onDelete && (
              <button type="button" onClick={() => { onDelete(contactId); onClose(); }} className="rounded-md border border-red-700 bg-red-900/20 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-800/30">
                Loeschen
              </button>
            )}
            <div className="flex-1" />
            <button type="button" onClick={onClose} className="rounded-md border border-gray-600 bg-gray-900 px-4 py-2 text-xs text-gray-300 hover:bg-gray-700">Abbrechen</button>
            <button type="button" onClick={handleSave} className="rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700">Speichern</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -- ContactList --

const PUBLIC_CHANNEL_ID = 'public';

export const ContactList = ({
  selectedContact,
  onSelectContact,
  contacts,
  onScanNodes,
  onRefreshPeers,
  onAddContact,
  myKey,
  myKeyNodeId,
  onGenerateMyKey,
  onAddPeerKey,
  onDeletePeerKey,
  peerKeys,
  peerKeyStatus,
  isBusy = false,
}: ContactListProps) => {
  const [newContactId, setNewContactId] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [peerKeyInput, setPeerKeyInput] = useState('');
  const [peerKeyError, setPeerKeyError] = useState('');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [peerKeyModalContact, setPeerKeyModalContact] = useState<string | null>(null);

  const handleImportKey = () => {
    setPeerKeyError('');
    const parsed = parseQrPayload(peerKeyInput);
    if (!parsed) {
      const cleaned = peerKeyInput.trim().toUpperCase().replace(/^0X/i, '');
      if (/^[0-9A-F]{32}$/.test(cleaned) && selectedContact) {
        onAddPeerKey(selectedContact, cleaned);
        setPeerKeyInput('');
        return;
      }
      setPeerKeyError('Format: MEGAMESH:0xID:KEY oder 32 HEX + Kontakt auswaehlen');
      return;
    }
    onAddPeerKey(parsed.nodeId, parsed.key);
    setPeerKeyInput('');
  };

  const handleQrScan = (data: string) => {
    setShowQrScanner(false);
    const parsed = parseQrPayload(data);
    if (parsed) {
      onAddPeerKey(parsed.nodeId, parsed.key);
      setPeerKeyInput('');
      setPeerKeyError('');
    } else {
      setPeerKeyInput(data);
      setPeerKeyError('QR erkannt, Format ungueltig');
    }
  };

  const qrPayload = myKey || '';

  return (
    <>
      {showKeyModal && (
        <KeySettingsModal myKey={myKey} myKeyNodeId={myKeyNodeId} isBusy={isBusy} onGenerate={onGenerateMyKey} onClose={() => setShowKeyModal(false)} />
      )}
      {showQrScanner && (
        <QrScanner onScan={handleQrScan} onClose={() => setShowQrScanner(false)} />
      )}
      {peerKeyModalContact && (
        <PeerKeyModal
          contactId={peerKeyModalContact}
          existingKey={peerKeys.get(peerKeyModalContact) ?? null}
          onSave={onAddPeerKey}
          onDelete={onDeletePeerKey}
          onClose={() => setPeerKeyModalContact(null)}
        />
      )}

      <div className="flex h-full flex-col">
        {/* Node management */}
        <div className="border-b p-4 space-y-3">
          <h2 className="text-lg font-semibold text-gray-100">Kanaele & Nodes</h2>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={onScanNodes} disabled={isBusy} className="rounded-md bg-primary-600 px-3 py-2 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
              Scannen
            </button>
            <button onClick={onRefreshPeers} disabled={isBusy} className="rounded-md bg-gray-700 px-3 py-2 text-xs font-medium text-gray-300 hover:bg-gray-600 disabled:opacity-50">
              Aktualisieren
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Node-ID (hex)"
              value={newContactId}
              onChange={(e) => setNewContactId(e.target.value)}
              className="flex-1 rounded-md border border-gray-600 px-2 py-2 text-xs focus:border-primary-500 focus:outline-none"
            />
            <button
              onClick={() => { if (!newContactId.trim()) return; onAddContact(newContactId.trim()); setNewContactId(''); }}
              className="rounded-md bg-gray-800 px-3 py-2 text-xs font-medium text-white hover:bg-gray-600"
            >
              +
            </button>
          </div>
        </div>

        {/* Channel + contact list */}
        <div className="flex-1 overflow-y-auto">
          {/* Public channel */}
          <div className="divide-y">
            <div
              className={`flex items-center transition-colors hover:bg-blue-900/30 cursor-pointer ${
                selectedContact === PUBLIC_CHANNEL_ID ? 'border-l-4 border-blue-500 bg-blue-900/20' : ''
              }`}
            >
              <button onClick={() => onSelectContact(PUBLIC_CHANNEL_ID)} className="flex-1 px-4 py-3 text-left">
                <p className="text-sm font-medium text-blue-300">Oeffentlicher Kanal</p>
                <p className="text-[11px] text-blue-600">Standard-Key, alle Nodes</p>
              </button>
            </div>
          </div>

          {/* Nodes */}
          {contacts.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-400">Keine Nodes gefunden</div>
          ) : (
            <div className="divide-y">
              {contacts.map((contact) => {
                const hasPeerKey = peerKeys.has(contact.id);
                return (
                  <div
                    key={contact.id}
                    className={`flex items-center transition-colors hover:bg-gray-700 ${
                      selectedContact === contact.id ? 'border-l-4 border-primary-500 bg-primary-900/20' : ''
                    }`}
                  >
                    <button onClick={() => onSelectContact(contact.id)} className="flex-1 px-4 py-3 text-left">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-100">{contact.name}</p>
                          <p className="truncate font-mono text-xs text-gray-400">{contact.id}</p>
                          {contact.lastSeenMs !== undefined && (
                            <p className="text-[11px] text-gray-400">vor {Math.floor(contact.lastSeenMs / 1000)}s</p>
                          )}
                        </div>
                        <span className={`ml-2 inline-block h-2 w-2 rounded-full ${contact.isOnline ? 'bg-green-500' : 'bg-gray-600'}`} />
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setPeerKeyModalContact(contact.id); }}
                      title={hasPeerKey ? 'Key gespeichert' : 'Key eingeben'}
                      className={`mr-3 flex-shrink-0 rounded-md border px-2.5 py-1.5 text-[10px] font-medium transition-colors ${
                        hasPeerKey
                          ? 'border-green-700 bg-green-900/20 text-green-400 hover:bg-green-800/30'
                          : 'border-gray-600 bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
                      }`}
                    >
                      {hasPeerKey ? 'KEY' : 'key?'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Encryption section */}
        <div className="border-t p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-300">Verschluesselung</p>
            <button
              type="button"
              onClick={() => setShowKeyModal(true)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                myKey
                  ? 'border-green-700 bg-green-900/20 text-green-400 hover:bg-green-800/30'
                  : 'border-gray-600 bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {myKey ? 'Key aktiv' : 'Kein Key'}
            </button>
          </div>

          {myKey && (
            <div className="rounded-md border border-gray-700 bg-gray-800 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-gray-400">Dein Key</span>
                <button type="button" onClick={() => setShowQr(v => !v)} className="text-[11px] text-blue-600 underline">
                  {showQr ? 'QR aus' : 'QR'}
                </button>
              </div>
              <p className="break-all font-mono text-[10px] text-gray-400 select-all">
                {myKey}
              </p>
              {showQr && qrPayload && (
                <div className="flex flex-col items-center gap-1 pt-1">
                  <div className="rounded-lg bg-white p-2">
                    <QRCodeSVG value={qrPayload} size={140} bgColor="#ffffff" fgColor="#000000" />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-gray-400">Key importieren</p>
              <button type="button" onClick={() => setShowQrScanner(true)} className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700">
                QR scannen
              </button>
            </div>
            <textarea
              rows={2}
              placeholder="MEGAMESH:0xID:KEY oder 32 HEX"
              value={peerKeyInput}
              onChange={(e) => { setPeerKeyInput(e.target.value); setPeerKeyError(''); }}
              className="w-full rounded-md border border-gray-600 px-2 py-1.5 font-mono text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
            {peerKeyError && <p className="text-[11px] text-red-400">{peerKeyError}</p>}
            {peerKeyStatus && <p className="text-[11px] text-green-400">{peerKeyStatus}</p>}
            <button
              onClick={handleImportKey}
              disabled={isBusy || !peerKeyInput.trim()}
              className="w-full rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              Speichern
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
