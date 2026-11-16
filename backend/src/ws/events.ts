// Входящие события клиента

export class JoinRoomEvent {
  roomId: number;

  constructor(roomId: number) {
    this.roomId = roomId;
  }
}

export class LeaveRoomEvent {
  roomId: number;

  constructor(roomId: number) {
    this.roomId = roomId;
  }
}

export class SendMessageEvent {
  roomId: number;
  content: string;
  clientMsgId: string;

  constructor(roomId: number, content: string, clientMsgId: string) {
    this.roomId = roomId;
    this.content = content;
    this.clientMsgId = clientMsgId;
  }
}

export class EditMessageEvent {
  messageId: number;
  content: string;

  constructor(messageId: number, content: string) {
    this.messageId = messageId;
    this.content = content;
  }
}

export class DeleteMessageEvent {
  messageId: number;

  constructor(messageId: number) {
    this.messageId = messageId;
  }
}

export class TypingEvent {
  roomId: number;

  constructor(roomId: number) {
    this.roomId = roomId;
  }
}

export class MarkReadEvent {
  roomId: number;
  messageId: number;

  constructor(roomId: number, messageId: number) {
    this.roomId = roomId;
    this.messageId = messageId;
  }
}

export class ToggleReactionEvent {
  messageId: number;
  emoji: string;

  constructor(messageId: number, emoji: string) {
    this.messageId = messageId;
    this.emoji = emoji;
  }
}

export class PingEvent {}
