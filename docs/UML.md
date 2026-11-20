# UML-диаграммы бэкенда

Диаграммы нарисованы в формате Mermaid: GitHub показывает их прямо на странице. Они описывают бэкенд (`backend/src`) и показывают, из каких классов он состоит и как они связаны. Общая схема системы (браузер, Nginx, два инстанса, Redis, PostgreSQL) приведена в [README](../README.md#архитектура).

Обозначения: `<|--` наследование, `*--` композиция (один объект создаёт и хранит другой), `-->` ассоциация (класс держит ссылку на другой и вызывает его), `..>` зависимость (класс только пользуется другим).

## 1. Слои: маршруты, сервисы, репозитории

Запрос идёт сверху вниз: маршрут Fastify берёт нужный сервис из `ServiceContainer`, сервис вызывает репозитории, репозитории выполняют SQL в PostgreSQL.

```mermaid
classDiagram
    direction TB

    class Routes {
        <<module>>
    }
    note for Routes "auth, users, rooms, health: HTTP-маршруты Fastify"

    class ServiceContainer {
        +getAuthService()
        +getRoomService()
        +getRoomFacade()
        +getUserManager()
        +getMessageService()
        +getPresence()
        +getBus()
        +getRateLimiter()
        +getSubscriptions()
    }

    class AuthService {
        +register(username, email, password)
        +login(email, password)
        +refresh(rawToken)
        +logout(rawToken)
        +verifyAccessToken(token)
    }
    class TokenManager {
        +save(userId, tokenHash, expiresAt)
        +findActive(tokenHash)
        +revoke(id)
    }
    class RoomService {
        +createGroup(userId, name, type)
        +openDirect(userId, peerId)
        +join(roomId, userId)
        +leave(roomId, userId)
        +invite(roomId, inviterId, targetUserId)
        +listForUser(userId)
        +listPublic(query, cursor)
        +getMembers(roomId, requesterId)
    }
    class RoomFacade {
        +createGroup()
        +join()
        +leave()
        +listForUser()
    }
    class UserManager {
        +getById(id)
        +updateProfile()
        +search(query, excludeId, limit)
    }
    class MessageService {
        +send(roomId, userId, content, clientMsgId)
        +edit(messageId, userId, content)
        +remove(messageId, userId)
        +markRead(roomId, userId, messageId)
        +getHistory(roomId, userId, beforeId, limit)
        +search(roomId, userId, query)
        +toggleReaction(messageId, userId, emoji)
    }
    class PresenceService {
        +connected(userId, connId)
        +disconnected(userId, connId)
        +onlineMap(userIds)
        +isOnline(userId)
    }
    class RateLimiter {
        +allow(key, limit, windowMs)
    }
    class RoomBus {
        +publishRoom(roomId, type, payload)
        +publishMembership(kind, roomId, userId)
        +subscribeRoom(roomId)
    }
    class RoomSubscriptions {
        +subscribe(roomId, conn)
        +subscribeUser(roomId, userId)
        +connectionsOf(roomId)
    }

    class BaseRepository~T~ {
        <<abstract>>
        +findAll(limit)
        +count()
        +mapRow(row)
    }
    class UserRepository {
        +findById(id)
        +getUserByMail(email)
        +findByUsername(username)
        +create(username, email, hash, displayName)
        +search(query, excludeId, limit)
    }
    class RoomRepository {
        +findById(id)
        +createGroup(type, name, createdBy)
        +createDirect(userId, peerId)
        +addMember(roomId, userId, role)
        +getMember(roomId, userId)
        +listPublic(query, cursor, limit)
        +listForUser(userId)
        +markRead(roomId, userId, messageId)
    }
    class MessageRepository {
        +insertIdempotent(roomId, userId, content, clientMsgId)
        +history(roomId, beforeId, limit)
        +search(roomId, query, beforeId, limit)
        +updateContent(id, content)
        +softDelete(id)
    }
    class ReactionRepository {
        +toggle(messageId, userId, emoji)
        +listForMessages(messageIds)
    }
    class TokenRepository {
        +save(userId, tokenHash, expiresAt)
        +findActive(tokenHash)
        +revoke(id)
    }

    Routes ..> ServiceContainer : app.container

    ServiceContainer *-- AuthService
    ServiceContainer *-- RoomService
    ServiceContainer *-- RoomFacade
    ServiceContainer *-- UserManager
    ServiceContainer *-- MessageService
    ServiceContainer *-- PresenceService
    ServiceContainer *-- RateLimiter
    ServiceContainer *-- RoomBus
    ServiceContainer *-- RoomSubscriptions

    AuthService --> UserRepository
    AuthService --> TokenManager
    TokenManager --> TokenRepository
    RoomService --> RoomRepository
    RoomService --> UserRepository
    RoomService --> PresenceService
    RoomService --> RoomSubscriptions
    RoomFacade --> RoomService
    UserManager --> UserRepository
    MessageService --> MessageRepository
    MessageService --> RoomRepository
    MessageService --> ReactionRepository
    PresenceService --> UserRepository
    PresenceService --> RoomRepository

    BaseRepository <|-- UserRepository
    BaseRepository <|-- RoomRepository
```

## 2. Правила комнат и заголовки комнат по типам

Для трёх типов комнат (публичная, приватная, личный диалог) есть две отдельные иерархии: правила (кто может войти, пригласить, выйти) и заголовок в списке комнат. Нужный класс выбирают фабричные функции `createRoomPolicy(type)` и `createRoomPresenter(type)`.

```mermaid
classDiagram
    direction LR

    class RoomService
    class RoomPolicy {
        <<abstract>>
        +canSelfJoin()
        +canInvite(role)
        +canLeave()
    }
    class PublicRoomPolicy
    class PrivateRoomPolicy
    class DirectRoomPolicy

    class RoomPresenter {
        <<abstract>>
        +title(row, peer)
    }
    class PublicRoomPresenter
    class PrivateRoomPresenter
    class DirectRoomPresenter

    RoomPolicy <|-- PublicRoomPolicy
    RoomPolicy <|-- PrivateRoomPolicy
    RoomPolicy <|-- DirectRoomPolicy

    RoomPresenter <|-- PublicRoomPresenter
    RoomPresenter <|-- PrivateRoomPresenter
    RoomPresenter <|-- DirectRoomPresenter

    RoomService ..> RoomPolicy : createRoomPolicy(type)
    RoomService ..> RoomPresenter : createRoomPresenter(type)
```

## 3. WebSocket: шлюз, подключения и обработчики событий

`ChatGateway` принимает кадры от клиентов, разбирает конверт `{ type, payload }` и передаёт событие нужному обработчику. Каждый тип события обрабатывает свой класс-наследник `ChatEventHandler`. Рассылку подключениям комнаты и по шине между инстансами выполняет шлюз.

```mermaid
classDiagram
    direction TB

    class ChatGateway {
        +attach(server)
        +processFrame(conn, raw)
        +broadcast(roomId, except, type, payload)
        +broadcastToOthers(roomId, userId, type, payload)
        +sendFrame(conn, type, payload)
        +shutdown()
    }
    class ChatConnection {
        id
        userId
        rooms
        +getSession()
    }
    class ChatSession {
        +getSocket()
    }
    class RoomSubscriptions {
        +subscribe(roomId, conn)
        +unsubscribe(roomId, conn)
        +connectionsOf(roomId)
    }
    class ServiceContainer
    class RoomBus

    class ChatEventHandler~E~ {
        <<abstract>>
        +parse(payload) E
        +handle(conn, event)
    }
    class JoinRoomHandler
    class LeaveRoomHandler
    class SendMessageHandler
    class EditMessageHandler
    class DeleteMessageHandler
    class TypingHandler
    class MarkReadHandler
    class ToggleReactionHandler
    class PingHandler

    ChatGateway --> ServiceContainer
    ChatGateway --> RoomSubscriptions
    ChatGateway --> RoomBus : публикует события комнаты
    ChatGateway o-- ChatConnection : подключения клиентов
    ChatConnection *-- ChatSession
    RoomSubscriptions o-- ChatConnection : подписчики комнат

    ChatGateway *-- ChatEventHandler : по одному на тип события
    ChatEventHandler --> ChatGateway

    ChatEventHandler <|-- JoinRoomHandler
    ChatEventHandler <|-- LeaveRoomHandler
    ChatEventHandler <|-- SendMessageHandler
    ChatEventHandler <|-- EditMessageHandler
    ChatEventHandler <|-- DeleteMessageHandler
    ChatEventHandler <|-- TypingHandler
    ChatEventHandler <|-- MarkReadHandler
    ChatEventHandler <|-- ToggleReactionHandler
    ChatEventHandler <|-- PingHandler
```

## 4. Модели данных

Записи таблиц БД (`UserRecord`, `RoomRecord`, `MemberRecord`, `MessageRecord`) и объекты, которые сервисы отдают клиентам (`RoomSummaryDto`, `MemberInfoDto`).

```mermaid
classDiagram
    direction LR

    class UserRecord {
        id
        username
        email
        passwordHash
        displayName
        avatarUrl
        lastSeenAt
        createdAt
    }
    class RoomRecord {
        id
        type
        name
        createdBy
        directKey
        createdAt
    }
    class MemberRecord {
        roomId
        userId
        role
        lastReadMessageId
        joinedAt
    }
    class MessageRecord {
        id
        roomId
        senderId
        clientMsgId
        content
        createdAt
        editedAt
        deletedAt
    }

    class RoomSummaryDto {
        id
        type
        title
        role
        unread
    }
    class PeerDto {
        id
        username
        displayName
        avatarUrl
    }
    class LastMessageDto {
        id
        senderId
        content
        createdAt
    }
    class MemberInfoDto {
        userId
        username
        role
        online
        lastSeenAt
        lastReadMessageId
    }

    UserRecord "1" --> "*" MemberRecord : состоит в комнатах
    RoomRecord "1" --> "*" MemberRecord : участники
    RoomRecord "1" --> "*" MessageRecord : сообщения
    UserRecord "1" --> "*" MessageRecord : отправитель

    RoomSummaryDto --> PeerDto : собеседник в личном диалоге
    RoomSummaryDto --> LastMessageDto : последнее сообщение
```

## 5. Последовательность: отправка сообщения

Клиент отправляет `send_message` по WebSocket на один инстанс, а получатель подключён ко второму. Сообщение сохраняется один раз, отправитель получает `message_ack`, остальные подключения комнаты на первом инстансе получают `new_message` напрямую, а на втором через Redis Pub/Sub.

```mermaid
sequenceDiagram
    autonumber
    actor A as Клиент, вкладка 1
    participant GW as ChatGateway (api1)
    participant H as SendMessageHandler
    participant RL as RateLimiter
    participant MS as MessageService
    participant DB as PostgreSQL
    participant L as Другие подключения комнаты (api1)
    participant BUS as RoomBus
    participant R as Redis Pub/Sub
    participant GW2 as ChatGateway (api2)
    actor B as Клиент на другом инстансе

    A->>GW: send_message (roomId, content, clientMsgId)
    GW->>H: parse и handle
    H->>RL: allow (не более 20 за 10 секунд)
    RL-->>H: разрешено
    H->>MS: send(roomId, userId, content, clientMsgId)
    MS->>DB: проверка членства в комнате
    MS->>DB: INSERT ON CONFLICT DO NOTHING
    DB-->>MS: сохранённое сообщение
    MS-->>H: message и признак duplicate
    alt это не повторная отправка
        H->>GW: broadcast(roomId, кроме отправителя, new_message)
        GW-->>L: new_message
        GW->>BUS: publishRoom
        BUS->>R: PUBLISH room:roomId
        R-->>GW2: событие комнаты
        GW2-->>B: new_message
    end
    H-->>A: message_ack (clientMsgId, message)
```
