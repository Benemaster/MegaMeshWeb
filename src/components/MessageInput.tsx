import { useState, type FormEvent } from 'react';

interface MessageInputProps {
  recipient: string;
  onSendMessage: (recipient: string, content: string) => void;
  disabled?: boolean;
}

export const MessageInput = ({ recipient, onSendMessage, disabled }: MessageInputProps) => {
  const [text, setText] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSendMessage(recipient, trimmed);
    setText('');
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-white/5 bg-surface-100/50 px-4 py-3">
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Nachricht eingeben…"
        disabled={disabled}
        className="input-cyber flex-1"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="btn-primary px-5 py-2.5 disabled:opacity-40"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
        </svg>
      </button>
    </form>
  );
};
