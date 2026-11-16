import { z } from 'zod';
import { ALLOWED_REACTIONS } from '../reactions';

// Протокол WebSocket: кадр { type, payload }

export const envelopeSchema = z.object({
  type: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const joinRoomPayload = z.object({
  roomId: z.number().int().positive(),
});

export const leaveRoomPayload = z.object({
  roomId: z.number().int().positive(),
});

export const sendMessagePayload = z.object({
  roomId: z.number().int().positive(),
  content: z.string().min(1).max(4000),
  clientMsgId: z.string().uuid(),
});

export const editMessagePayload = z.object({
  messageId: z.number().int().positive(),
  content: z.string().min(1).max(4000),
});

export const deleteMessagePayload = z.object({
  messageId: z.number().int().positive(),
});

export const toggleReactionPayload = z.object({
  messageId: z.number().int().positive(),
  emoji: z.enum(ALLOWED_REACTIONS),
});

export const typingPayload = z.object({
  roomId: z.number().int().positive(),
});

export const markReadPayload = z.object({
  roomId: z.number().int().positive(),
  messageId: z.number().int().positive(),
});

// Превращает исходящее событие в строку для отправки
export class FrameEncoder {
  static encode(type: string, payload: unknown): string {
    return JSON.stringify({ type, payload });
  }
}
