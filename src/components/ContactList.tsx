import { useState } from 'react';

interface Contact {
  id: string;
  name: string;
  lastSeen?: Date;
  isOnline: boolean;
}

interface ContactListProps {
  selectedContact: string | null;
  onSelectContact: (contactId: string) => void;
}

export const ContactList = ({ selectedContact, onSelectContact }: ContactListProps) => {
  const [contacts, setContacts] = useState<Contact[]>([
    { id: 'NODE-ABC123', name: 'NODE-ABC123', isOnline: true, lastSeen: new Date() },
  ]);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactId, setNewContactId] = useState('');

  const handleAddContact = () => {
    if (!newContactId.trim()) return;

    const newContact: Contact = {
      id: newContactId,
      name: newContactId,
      isOnline: false,
    };

    setContacts([...contacts, newContact]);
    setNewContactId('');
    setShowAddContact(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold text-gray-900">Kontakte</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {contacts.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            Noch keine Kontakte
          </div>
        ) : (
          <div className="divide-y">
            {contacts.map((contact) => (
              <button
                key={contact.id}
                onClick={() => onSelectContact(contact.id)}
                className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                  selectedContact === contact.id ? 'bg-primary-50 border-l-4 border-primary-500' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {contact.name}
                    </p>
                    <p className="text-xs text-gray-500 font-mono truncate">
                      {contact.id}
                    </p>
                  </div>
                  <div className="ml-2">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        contact.isOnline ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="p-4 border-t">
        {!showAddContact ? (
          <button
            onClick={() => setShowAddContact(true)}
            className="w-full px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            + Kontakt hinzufügen
          </button>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Node-ID eingeben"
              value={newContactId}
              onChange={(e) => setNewContactId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 text-sm"
              onKeyPress={(e) => e.key === 'Enter' && handleAddContact()}
            />
            <div className="flex space-x-2">
              <button
                onClick={handleAddContact}
                className="flex-1 px-3 py-2 bg-primary-600 text-white text-sm rounded-md hover:bg-primary-700"
              >
                Hinzufügen
              </button>
              <button
                onClick={() => {
                  setShowAddContact(false);
                  setNewContactId('');
                }}
                className="flex-1 px-3 py-2 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
