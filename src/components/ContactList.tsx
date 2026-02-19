import { useState } from 'react';

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
  networkKey: string;
  onNetworkKeyChange: (value: string) => void;
  onApplyNetworkKey: () => void;
  onGenerateNetworkKey: () => void;
  onSendKeyToSelected: () => void;
  isBusy?: boolean;
}

export const ContactList = ({
  selectedContact,
  onSelectContact,
  contacts,
  onScanNodes,
  onRefreshPeers,
  onAddContact,
  networkKey,
  onNetworkKeyChange,
  onApplyNetworkKey,
  onGenerateNetworkKey,
  onSendKeyToSelected,
  isBusy = false,
}: ContactListProps) => {
  const [newContactId, setNewContactId] = useState('');

  return (
    <div className="flex h-full flex-col">
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
            Peers laden
          </button>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Node-ID manuell"
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
            Hinzufügen
          </button>
        </div>
      </div>

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
                      <p className="text-[11px] text-gray-400">Zuletzt gesehen: vor {Math.floor(contact.lastSeenMs / 1000)}s</p>
                    )}
                  </div>
                  <span className={`inline-block h-2 w-2 rounded-full ${contact.isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t p-4 space-y-2">
        <p className="text-xs font-semibold text-gray-700">Mesh-Schlüssel (optional)</p>
        <p className="text-[11px] text-gray-500">Für unverschlüsseltes Mesh nicht erforderlich.</p>
        <input
          type="text"
          value={networkKey}
          onChange={(e) => onNetworkKeyChange(e.target.value)}
          placeholder="32-stelliger HEX-Key"
          className="w-full rounded-md border border-gray-300 px-2 py-2 font-mono text-xs focus:border-primary-500 focus:outline-none focus:ring-primary-500"
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onApplyNetworkKey}
            disabled={isBusy}
            className="rounded-md bg-primary-600 px-3 py-2 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            Key setzen
          </button>
          <button
            onClick={onGenerateNetworkKey}
            disabled={isBusy}
            className="rounded-md bg-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
          >
            Key erzeugen
          </button>
        </div>
        <button
          onClick={onSendKeyToSelected}
          disabled={isBusy || !selectedContact}
          className="w-full rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Key an ausgewählte Node senden
        </button>
      </div>
    </div>
  );
};
