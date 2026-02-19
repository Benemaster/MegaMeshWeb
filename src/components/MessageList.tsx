import { Message } from '../types/messaging';

interface MessageListProps {
  messages: Message[];
}

export const MessageList = ({ messages }: MessageListProps) => {

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-500">
          Noch keine Nachrichten
        </div>
      ) : (
        messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.sender === 'me' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                message.sender === 'me'
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-200 text-gray-900'
              }`}
            >
              <p>{message.content}</p>
              <div className="flex items-center justify-between mt-1 text-xs opacity-75">
                <span>{new Date(message.timestamp).toLocaleTimeString('de-DE')}</span>
                <span className="ml-2">
                  {message.via === 'radio' ? 'Funk' : 'Backend'} ·
                  {message.status === 'delivered' && ' zugestellt'}
                  {message.status === 'sent' && ' gesendet'}
                  {message.status === 'pending' && ' ausstehend'}
                  {message.status === 'failed' && ' fehlgeschlagen'}
                </span>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
};
