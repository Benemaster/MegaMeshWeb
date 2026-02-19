import { useState, FormEvent } from 'react';

interface MessageInputProps {
  recipient: string;
  onSendMessage: (recipient: string, content: string) => Promise<void> | void;
  disabled?: boolean;
}

export const MessageInput = ({ recipient, onSendMessage, disabled = false }: MessageInputProps) => {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim() || sending || disabled) return;

    setSending(true);
    await onSendMessage(recipient, message.trim());
    setSending(false);
    setMessage('');
  };

  return (
    <div className="border-t border-gray-200 p-4">
      <form onSubmit={handleSubmit} className="flex space-x-2">
        <input
          type="text"
          placeholder="Nachricht eingeben..."
          value={message}
          disabled={disabled || sending}
          onChange={(e) => setMessage(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
        />
        <button
          type="submit"
          disabled={disabled || sending}
          className="px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          {sending ? 'Sende…' : 'Senden'}
        </button>
      </form>
    </div>
  );
};
