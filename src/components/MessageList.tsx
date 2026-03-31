import { Message } from '../types/messaging';

interface MessageListProps {
  messages: Message[];
}

export const MessageList = ({ messages }: MessageListProps) => {

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-500 text-sm">
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
              className={`max-w-xs lg:max-w-md px-4 py-2.5 rounded-xl ${
                message.sender === 'me'
                  ? 'bg-gradient-to-r from-primary-600/80 to-primary-500/80 text-white'
                  : 'border border-white/5 bg-surface-200/80 text-gray-100'
              }`}
            >
              {message.sender !== 'me' && (
                <p className="mb-0.5 text-[10px] font-medium text-primary-400/80">
                  Node 0x{message.sender}
                </p>
              )}
              <p className="text-sm">{message.content}</p>
              <div className="flex items-center justify-between mt-1.5 text-[10px] opacity-60">
                <span>{new Date(message.timestamp).toLocaleTimeString('de-DE')}</span>
                <span className="ml-2">
                  {message.via === 'radio' ? 'Funk' : 'Backend'}
                  {message.encrypted && ' · 🔒'}
                  {' · '}
                  {message.status === 'delivered' && 'zugestellt'}
                  {message.status === 'sent' && 'gesendet'}
                  {message.status === 'pending' && 'ausstehend'}
                  {message.status === 'failed' && 'fehlgeschlagen'}
                </span>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
};
