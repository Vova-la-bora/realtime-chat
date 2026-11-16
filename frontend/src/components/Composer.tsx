import { FormEvent, KeyboardEvent, useState } from 'react';
import { chatClient } from '../chat/chatClient';
import styles from './Chat.module.css';

// Поле ввода: Enter отправляет, Shift+Enter переносит строку
export function Composer({ roomId }: { roomId: number }) {
  const [text, setText] = useState('');
  const content = text.trim();
  const tooLong = text.length > 4000;
  const canSend = content.length > 0 && !tooLong;

  const submit = () => {
    if (!canSend) {
      return;
    }
    chatClient.sendMessage(roomId, content);
    setText('');
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form className={styles.composer} onSubmit={handleSubmit}>
      <label className="srOnly" htmlFor={`composer-${roomId}`}>
        Сообщение
      </label>
      <textarea
        id={`composer-${roomId}`}
        className={styles.input}
        rows={2}
        value={text}
        placeholder="Напишите сообщение…"
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.length > 0) {
            chatClient.notifyTyping(roomId);
          }
        }}
        onKeyDown={handleKeyDown}
        aria-invalid={tooLong}
        aria-describedby={text.length > 3500 ? `counter-${roomId}` : undefined}
      />
      {text.length > 3500 && (
        <span
          id={`counter-${roomId}`}
          className={tooLong ? styles.counterError : styles.counter}
          role={tooLong ? 'alert' : undefined}
        >
          {text.length} / 4000
        </span>
      )}
      <button type="submit" className={styles.send} disabled={!canSend}>
        Отправить
      </button>
    </form>
  );
}
