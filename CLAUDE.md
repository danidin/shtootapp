# Shtoot Application

Real-time messaging/social communication application with a decentralized architecture.

## Key Components

| Component | Description |
|-----------|-------------|
| **ozen** | GraphQL backend (Apollo Server + TypeScript) with JWT auth, WebSocket subscriptions, and Kafka integration |
| **peh** | Frontend built with vanilla Web Components - handles messaging UI, notifications, and real-time updates |
| **ozen-gateway** | Nginx reverse proxy with SSL/TLS |

## Main Features

- Real-time messaging via GraphQL WebSocket subscriptions
- Space-based privacy - messages can be public or confined to private groups
- Desktop notifications with Service Worker support
- Kafka event streaming for decentralized message handling
- JWT authentication with email-based identity
- Mobile-responsive UI
- End-to-end encryption for 1:1 messages (hybrid RSA-OAEP + AES-GCM)

## How It Works

Users post "shtoots" (messages) which can be public or within private spaces. The GraphQL server handles CRUD operations and broadcasts new messages to subscribed clients in real-time via WebSockets. Kafka is used for event streaming across the system.

## Development

Run the stack with Docker Compose:
```bash
docker-compose up
```

- Backend runs on port 4000
- Frontend serves static files from `/peh`

---

## E2E Encryption

1:1 messages use **hybrid encryption** (RSA-OAEP + AES-GCM), with private keys stored in IndexedDB and public keys distributed via Kafka events.

### How It Works
RSA-OAEP 2048-bit can only encrypt ~190 bytes directly. For messages of any length:
1. Generate random AES-256 key per message
2. Encrypt message with AES-GCM (fast, unlimited length)
3. Encrypt the AES key with recipient's RSA public key
4. Send both together

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Browser A     │     │     Kafka       │     │   Browser B     │
│                 │     │                 │     │                 │
│ ┌─────────────┐ │     │ ┌─────────────┐ │     │ ┌─────────────┐ │
│ │PrivKey(A)   │ │     │ │key-created  │ │     │ │PrivKey(B)   │ │
│ │(IndexedDB)  │ │     │ │  events     │ │     │ │(IndexedDB)  │ │
│ └─────────────┘ │     │ └─────────────┘ │     │ └─────────────┘ │
│                 │     │                 │     │                 │
│ encrypt(PubB)───┼────►│                 │────►│───decrypt(PrivB)│
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                        ┌─────▼─────┐
                        │   Ozen    │
                        │ /key/:email│
                        └───────────┘
```

### Key Files

| File | Role |
|------|------|
| `/ozen/index.ts` | `/key/:email` GET and `/key` POST endpoints |
| `/ozen/partzoof-producer.ts` | `sendKeyCreatedEvent()` |
| `/ozen/partzoof-consumer.ts` | Handles `key-created` events, exports `publicKeys` Map |
| `/peh/crypto.js` | Web Crypto helpers |
| `/peh/shtoot-peh.js` | Key init on login, encrypt on send, decrypt on receive |

### Message Format

Encrypted messages stored in `text` field as JSON:
```json
{
  "e2e": 1,
  "key": "<base64-RSA-encrypted-AES-key>",
  "iv": "<base64-12-byte-nonce>",
  "ct": "<base64-AES-GCM-ciphertext>"
}
```

### Visual Indicators
- Encrypted messages: 🔒 lock icon
- Unencrypted in 1:1 space: ⚠️ red warning badge

### Key Migration (device-to-device)

Keys can be migrated from one device to another via an encrypted export blob + 6-digit PIN.

**Export (old device):** Profile sidebar → "Export key…" → copy the blob and note the PIN
**Import (new device):** Profile sidebar → "Import key…" → paste blob + enter PIN → page reloads

The blob is the private key encrypted with AES-GCM, derived from the PIN via PBKDF2 (600k iterations). The private key never touches the server.

> Note: keys generated before this feature was added are non-extractable. "Export key…" will offer to regenerate a new key pair (old encrypted messages become unreadable after regeneration).

### Known Limitations (v1)
- Key loss = message loss (no recovery)
- Single device per user (no multi-device sync)
- In-memory keys on server (repopulated from Kafka on restart)
- No key rotation
