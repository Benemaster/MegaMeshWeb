import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

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
  // Own AES-128 key (peer-key model)
  myKey: string;
  myKeyNodeId: string;
  onGenerateMyKey: () => void;
  onAddPeerKey: (nodeId: string, key: string) => void;
  peerKeyStatus?: string;
  isBusy?: boolean;
}

/** QR payload format: MEGAMESH:0x<nodeId>:<key32hex> */
function buildQrPayload(nodeId: string, key: string): string {
  const id = nodeId.startsWith('0x') ? nodeId : `0x${nodeId}`;
  return `MEGAMESH:${id}:${key}`;
}

function parseQrPayload(raw: string): { nodeId: string; key: string } | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^MEGAMESH:(0x[0-9A-Fa-f]+):([0-9A-Fa-f]{32})$/i);
  if (match) {
    return { nodeId: match[1], key: match[2].toUpperCase() };
  }
  try {
    const obj = JSON.parse(trimmed);
    if (obj.id && obj.k && /^[0-9A-Fa-f]{32}$/.test(obj.k)) {
      return { nodeId: String(obj.id), key: String(obj.k).toUpperCase() };
    }
  } catch {
    // not JSON
  }
  return null;
}

// ── Key Settings Modal ────────────────────────────────────────────────────────

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

  const handleGenerate = () => {
    onGenerate();
    onClose();
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-4 w-full max-w-sm rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">AES-128 Schlüssel-Verwaltung</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Current key status */}
          <div className={`rounded-lg border p-3 ${hasKey ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
            <p className={`text-xs font-semibold ${hasKey ? 'text-green-800' : 'text-amber-800'}`}>
              {hasKey ? 'AES-128 Key aktiv' : 'Kein Key vorhanden'}
            </p>
            {hasKey ? (
              <>
                <p className="mt-1 font-mono text-[10px] text-green-700 break-all">{myKey}</p>
                <p className="mt-1 text-[11px] text-green-700">Node-ID: 0x{myKeyNodeId}</p>
              </>
            ) : (
              <p className="mt-1 text-[11px] text-amber-700">
                Generiere einen Key, um verschlüsselte Direktnachrichten zu nutzen.
              </p>
            )}
          </div>

          {/* Warning when key exists */}
          {hasKey && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-semibold text-red-800">Warnung: Key-Rotation</p>
              <p className="mt-1 text-[11px] text-red-700">
                Wenn du einen neuen Key generierst, können alle Peers, die deinen aktuellen Key
                gespeichert haben, deine verschlüsselten Nachrichten nicht mehr lesen.
                Du musst ihnen deinen neuen QR-Code schicken.
              </p>
              <label className="mt-3 flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 accent-red-600"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span className="text-[11px] text-red-700">
                  Ich verstehe, dass vorhandene Peers meinen Key neu importieren müssen.
                </span>
              </label>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Abbrechen
            </button>
            <button
              type="button"
              disabled={isBusy || (hasKey && !confirmed)}
              onClick={handleGenerate}
              className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {hasKey ? 'Neuen Key generieren' : 'Key erstmalig generieren'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ContactList ───────────────────────────────────────────────────────────────

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
  peerKeyStatus,
  isBusy = false,
}: ContactListProps) => {
  const [newContactId, setNewContactId] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [peerKeyInput, setPeerKeyInput] = useState('');
  const [peerKeyError, setPeerKeyError] = useState('');
  const [showKeyModal, setShowKeyModal] = useState(false);

  const handleImportKey = () => {
    setPeerKeyError('');
    const parsed = parseQrPayload(peerKeyInput);
    if (!parsed) {
      setPeerKeyError('Format ungültig. Erwartet: MEGAMESH:0xID:32HEX');
      return;
    }
    onAddPeerKey(parsed.nodeId, parsed.key);
    setPeerKeyInput('');
  };

  const qrPayload = myKey && myKeyNodeId ? buildQrPayload(myKeyNodeId, myKey) : '';

  return (
    <>
      {showKeyModal && (
        <KeySettingsModal
          myKey={myKey}
          myKeyNodeId={myKeyNodeId}
          isBusy={isBusy}
          onGenerate={onGenerateMyKey}
          onClose={() => setShowKeyModal(false)}
        />
      )}

      <div className="flex h-full flex-col">
        {/* Node management */}
        <div className="border-b p-4 space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Nodes</h2>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onScanNodes}
              disabled={isBusy}
              className="rounded-md bg-primary-600 px-3 py-2 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              Nodes scannen
            </button>
            <button
              onClick={onRefreshPeers}
              disabled={isBusy}
              className="rounded-md bg-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
            >
              Stationen laden
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Node-ID manuell (hex)"
              value={newContactId}
              onChange={(e) => setNewContactId(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-2 py-2 text-xs focus:border-primary-500 focus:outline-none focus:ring-primary-500"
            />
            <button
              onClick={() => {
                if (!newContactId.trim()) return;
                onAddContact(newContactId.trim());
                setNewContactId('');
              }}
              className="rounded-md bg-gray-800 px-3 py-2 text-xs font-medium text-white hover:bg-gray-900"
            >
              +
            </button>
          </div>
        </div>

        {/* Contact list */}
        <div className="flex-1 overflow-y-auto">
          {contacts.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">Noch keine Nodes gefunden</div>
          ) : (
            <div className="divide-y">
              {contacts.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => onSelectContact(contact.id)}
                  className={`w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                    selectedContact === contact.id ? 'border-l-4 border-primary-500 bg-primary-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{contact.name}</p>
                      <p className="truncate font-mono text-xs text-gray-500">{contact.id}</p>
                      {contact.lastSeenMs !== undefined && (
                        <p className="text-[11px] text-gray-400">
                          Zuletzt gesehen: vor {Math.floor(contact.lastSeenMs / 1000)}s
                        </p>
                      )}
                    </div>
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${contact.isOnline ? 'bg-green-500' : 'bg-gray-300'}`}
                    />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* AES-128 encryption section */}
        <div className="border-t p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-700">AES-128 Verschlüsselung</p>
              <p className="text-[11px] text-gray-500">Peer-Key austauschen via QR-Code</p>
            </div>
            <button
              type="button"
              onClick={() => setShowKeyModal(true)}
              title="Schlüssel-Einstellungen"
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                myKey
                  ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
                  : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
              }`}
            >
              {myKey ? '● Key aktiv' : '○ Kein Key'}
            </button>
          </div>

          {/* Own key — show only if set, no generate button here */}
          {myKey ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-gray-600">Eigener Key (AES-128)</span>
                <button
                  type="button"
                  onClick={() => setShowQr(v => !v)}
                  className="text-[11px] text-blue-600 underline"
                >
                  {showQr ? 'QR aus' : 'QR zeigen'}
                </button>
              </div>
              <p className="break-all font-mono text-[10px] text-gray-500 select-all">{myKey}</p>
              {showQr && qrPayload && (
                <div className="flex flex-col items-center gap-1 pt-1">
                  <QRCodeSVG value={qrPayload} size={140} />
                  <p className="text-[10px] text-gray-400 text-center">
                    Peer scannt diesen QR-Code und speichert deinen Key
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-gray-400">
              Kein Key generiert. Klicke auf "Kein Key" um einen zu erstellen.
            </p>
          )}

          {/* Import peer key */}
          <div className="space-y-1">
            <p className="text-[11px] text-gray-600">Peer-Key importieren (QR-Text einfügen):</p>
            <textarea
              rows={2}
              placeholder="MEGAMESH:0xA3B4:DEADBEEF012345678901234567890123"
              value={peerKeyInput}
              onChange={(e) => { setPeerKeyInput(e.target.value); setPeerKeyError(''); }}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
            {peerKeyError && <p className="text-[11px] text-red-600">{peerKeyError}</p>}
            {peerKeyStatus && <p className="text-[11px] text-green-700">{peerKeyStatus}</p>}
            <button
              onClick={handleImportKey}
              disabled={isBusy || !peerKeyInput.trim()}
              className="w-full rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              Key speichern
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
