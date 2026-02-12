import { useState } from 'react';
import { MessageList } from '../components/MessageList';
import { MessageInput } from '../components/MessageInput';
import { ContactList } from '../components/ContactList';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export const Dashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const nodeId = localStorage.getItem('nodeId');
  const connectionType = localStorage.getItem('connectionType');

  const handleLogout = () => {
    localStorage.removeItem('nodeId');
    localStorage.removeItem('connectionType');
    logout();
  };

  const handleDisconnect = () => {
    localStorage.removeItem('nodeId');
    localStorage.removeItem('connectionType');
    navigate('/connect');
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">MegaMesh</h1>
              <p className="text-sm text-gray-600">Willkommen, {user?.username}</p>
            </div>
            <div className="flex items-center space-x-4">
              {nodeId && (
                <div className="text-sm text-gray-600">
                  <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                  Node: <span className="font-mono text-xs">{nodeId}</span>
                  <span className="ml-2 text-xs">({connectionType === 'usb' ? 'USB' : 'BT'})</span>
                </div>
              )}
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-md"
              >
                Node trennen
              </button>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md"
              >
                Abmelden
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 overflow-hidden">
        <div className="w-80 bg-white rounded-lg shadow mr-4 flex flex-col">
          <ContactList 
            selectedContact={selectedContact} 
            onSelectContact={setSelectedContact} 
          />
        </div>

        <div className="flex-1 flex flex-col bg-white rounded-lg shadow overflow-hidden">
          {selectedContact ? (
            <>
              <div className="bg-gray-50 px-4 py-3 border-b">
                <h3 className="font-medium text-gray-900">{selectedContact}</h3>
              </div>
              <MessageList contactId={selectedContact} />
              <MessageInput recipient={selectedContact} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              Wähle einen Kontakt aus, um zu chatten
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
