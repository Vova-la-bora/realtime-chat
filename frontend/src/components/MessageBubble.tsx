import { KeyboardEvent, useState } from 'react';
import { cx } from '../lib/cx';
import { dateFormatter } from '../lib/dateFormatter';
import { REACTION_EMOJIS } from '../lib/reactions';
import { DisplayStatus, MessageModel } from '../models';
import { createStatusIndicator } from './statusIndicators';
import { createStatusLabel } from './statusLabels';
import styles from './Chat.module.css';

interface Props {
  message: MessageModel;
  own: boolean;
  senderName: string;
  // Собеседник в личном диалоге прочитал это сообщение
  read: boolean;
  // Текущий пользователь и имена участников нужны, чтобы показать, кто поставил реакцию
  meId: number | undefined;
  nameOf: (userId: number) => string;
  onRetry: (clientMsgId: string) => void;
  onEdit: (messageId: number, content: string) => void;
  onDelete: (messageId: number) => void;
  onReact: (messageId: number, emoji: string) => void;
}

// Одно сообщение. Текст выводится как обычный текст React (экранируется автоматически).
export function MessageBubble({
  message,
  own,
  senderName,
  read,
  meId,
  nameOf,
  onRetry,
  onEdit,
  onDelete,
  onReact,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const displayStatus: DisplayStatus = message.status === 'sent' && read ? 'read' : message.status;
  const indicator = createStatusIndicator(displayStatus);
  const label = createStatusLabel(displayStatus);
  // Менять и удалять можно только свои подтверждённые сообщения
  const canManage = own && message.status === 'sent' && message.id !== null && !message.deleted;

  const startEdit = () => {
    setDraft(message.content);
    setEditing(true);
  };

  const saveEdit = () => {
    const text = draft.trim();
    if (text.length === 0 || text.length > 4000) {
      return;
    }
    if (text !== message.content && message.id !== null) {
      onEdit(message.id, text);
    }
    setEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  };

  const handleDelete = () => {
    if (message.id !== null && window.confirm('Удалить сообщение?')) {
      onDelete(message.id);
    }
  };

  // Реакции доступны на любое подтверждённое неудалённое сообщение, своё или чужое
  const canReact = message.status === 'sent' && message.id !== null && !message.deleted;

  const react = (emoji: string) => {
    if (message.id !== null) {
      onReact(message.id, emoji);
    }
    setPickerOpen(false);
  };

  return (
    <li className={cx(styles.row, own && styles.rowOwn)}>
      <div
        className={cx(
          styles.bubble,
          own ? styles.bubbleOwn : styles.bubbleOther,
          message.status === 'error' && styles.bubbleError,
        )}
      >
        {!own && <span className={styles.sender}>{senderName}</span>}
        {editing ? (
          <div className={styles.editBox}>
            <textarea
              className={styles.editInput}
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Изменить сообщение"
              autoFocus
            />
            <span className={styles.msgActions}>
              <button type="button" className={styles.linkButton} onClick={saveEdit}>
                Сохранить
              </button>
              <button type="button" className={styles.linkButton} onClick={() => setEditing(false)}>
                Отмена
              </button>
            </span>
          </div>
        ) : (
          <p className={cx(styles.text, message.deleted && styles.deleted)}>{message.content}</p>
        )}
        {message.reactions.length > 0 && !message.deleted && (
          <span className={styles.reactions}>
            {message.reactions.map((r) => {
              const mine = meId !== undefined && r.userIds.includes(meId);
              return (
                <button
                  key={r.emoji}
                  type="button"
                  className={cx(styles.reactionChip, mine && styles.reactionChipMine)}
                  title={r.userIds.map(nameOf).join(', ')}
                  aria-pressed={mine}
                  aria-label={`Реакция ${r.emoji}: ${r.count}`}
                  onClick={() => react(r.emoji)}
                >
                  {r.emoji} {r.count}
                </button>
              );
            })}
          </span>
        )}
        <span className={styles.meta}>
          {message.editedAt && !message.deleted ? 'изменено · ' : ''}
          <time dateTime={message.createdAt}>{dateFormatter.formatTime(message.createdAt)}</time>
          {own && (
            <span
              className={cx(styles.status, styles[indicator.cssClass()])}
              title={label.text()}
              aria-label={label.ariaLabel()}
              role="img"
            >
              {indicator.symbol()}
            </span>
          )}
        </span>
        {(canManage || canReact) && !editing && (
          <span className={styles.msgActions}>
            {canReact && (
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => setPickerOpen((open) => !open)}
                aria-expanded={pickerOpen}
                aria-label="Добавить реакцию"
              >
                Реакция
              </button>
            )}
            {canManage && (
              <>
                <button type="button" className={styles.linkButton} onClick={startEdit}>
                  Изменить
                </button>
                <button type="button" className={styles.linkButton} onClick={handleDelete}>
                  Удалить
                </button>
              </>
            )}
          </span>
        )}
        {pickerOpen && canReact && !editing && (
          <span className={styles.picker} role="group" aria-label="Выберите реакцию">
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={styles.pickerButton}
                onClick={() => react(emoji)}
                aria-label={`Поставить ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </span>
        )}
        {message.status === 'error' && (
          <span className={styles.errorLine}>
            {message.error ?? 'Не отправлено'}
            <button
              type="button"
              className={styles.retry}
              onClick={() => onRetry(message.clientMsgId)}
            >
              Повторить
            </button>
          </span>
        )}
      </div>
    </li>
  );
}
