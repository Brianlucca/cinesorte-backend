<div align="center">

# CineSorte Backend

**The API and real-time infrastructure behind the CineSorte social entertainment platform.**

This service powers authentication, discovery, profiles, social interactions, messaging, watch progress, notifications, support workflows, and synchronized watch parties for CineSorte.

[Live application](https://cinesorte.vercel.app/) · [Frontend repository](https://github.com/Brianlucca/cinesorte) · [Portfolio](https://brianlucca.vercel.app/)

</div>

## Overview

CineSorte Backend is a modular Node.js and Express API built to support the full CineSorte product. It acts as the trusted layer between the React client, Firebase services, PostgreSQL, TMDB, the CineSorte Sync extension, and the platform's real-time communication channels.

The backend is responsible for more than catalog data. It manages user identity and sessions, social relationships, reviews and comments, custom lists, personalized activity, encrypted conversations, watch-party access, playback synchronization, extension pairing, operational alerts, and account lifecycle workflows.

## Platform capabilities

| Domain | Responsibilities |
| --- | --- |
| **Authentication and accounts** | Registration, email verification, Google sign-in, password and email changes, provider linking, secure sessions, account deletion, profile updates, and security activity. |
| **TMDB gateway** | Search, discovery, trending titles, current releases, genres, trailers, recommendations, providers, and detailed movie, show, season, episode, and person data without exposing the TMDB credential to the client. |
| **Social graph** | Following, followers, suggestions, compatibility scores, profile statistics, user blocking, and public profile data. |
| **Feed and reviews** | Global and following feeds, shared collections, ratings, reviews, comments, mentions, likes, moderation helpers, and activity aggregation. |
| **Lists and activity** | Custom media lists, public sharing, list cloning, saved interactions, viewing diary, and rated-review reconciliation. |
| **Messaging** | Direct and group conversations, membership controls, media attachments, unread state, conversation streams, and per-user visibility. |
| **Watch progress** | Progress history, CineSorte Sync pairing codes, revocable extension tokens, connected-device status, and stale-session cleanup. |
| **Watch parties** | Persistent rooms, access policies, invite and relationship-based visibility, queues, host controls, ephemeral presence, chat, playback signals, screen-sharing negotiation, and live room previews. |
| **Notifications and support** | Notification state, unread counters, support protocols, ticket history, administrative replies, and closure workflows. |

## Real-time architecture

CineSorte uses different real-time transports according to the type of interaction:

- **Server-Sent Events** keep message conversations, unread state, and client notifications current with lightweight server-to-client streams.
- **WebSockets** provide authenticated watch-party presence, temporary chat, host controls, media metadata, playback commands, and signaling messages.
- **Browser media signaling** carried through the WebSocket gateway coordinates screen-sharing sessions between hosts and viewers.

Watch-party chat and presence are intentionally ephemeral, while room configuration and access data remain persisted. Heartbeats, payload limits, message cooldowns, room membership validation, and origin checks protect the gateway from stale or unauthorized connections.

## Data and infrastructure

- **Firebase Authentication** provides identity verification and session-cookie validation.
- **Cloud Firestore** stores users, profiles, lists, reviews, comments, social relationships, notifications, messages, support tickets, and viewing activity.
- **Firebase Realtime Database** supports integrations that benefit from Firebase's real-time data layer.
- **PostgreSQL** persists watch-party rooms, membership, access rules, queues, and related relational state.
- **In-memory caching** reduces repeated requests for stable or frequently requested data, with bounded entries and domain-specific cache keys.
- **TMDB** supplies movie, television, season, episode, person, image, and provider metadata through a protected server-side client.

## Security model

Security is applied across the HTTP API and real-time gateway:

- Firebase session cookies are verified server-side, including revoked-session and verified-email checks.
- Production cookies use `httpOnly`, `secure`, scoped host naming, high priority, and cross-site partitioning controls.
- Helmet security headers, strict CORS rules, HTTPS enforcement, request-size limits, and trusted-origin checks reduce the exposed surface.
- State-changing requests receive origin and referer validation as CSRF protection.
- Zod schemas validate authentication, profile, social, message, list, and watch-party payloads.
- Route-specific rate limits protect authentication, registration, verification, TMDB, messaging, and extension pairing flows.
- Input sanitization rejects common script injection and event-handler patterns.
- Message bodies are encrypted with AES-256-GCM before persistence.
- Extension access uses dedicated pairing codes and revocable device tokens instead of account passwords.
- Blocking and membership checks are enforced within social, messaging, and watch-party operations.

## Operations and lifecycle

The service includes operational tooling beyond request handling:

- Structured application logging with Winston.
- Telegram alerts for suspicious traffic, brute-force attempts, rejected origins, resource pressure, and application events.
- Telegram-based operational summaries and support-ticket management.
- Scheduled cleanup for expired extension sessions and account-deletion workflows.
- Verification-email rescue processing for eligible accounts.
- Database migrations for watch-party persistence and access rules.
- Health checks for deployment monitoring and uptime services.
- Jest and Supertest coverage for controllers, integration flows, authorization, social features, and watch-party behavior.

## Project structure

```text
src/
├── config/                    Cookies, Firebase, PostgreSQL, and CORS
├── infrastructure/
│   ├── database/migrations/   Watch-party database evolution
│   ├── jobs/                  Background and lifecycle jobs
│   └── monitoring/            Telegram operations and alerts
├── modules/
│   ├── auth/                  Identity, sessions, verification, and account lifecycle
│   ├── interactions/          Ratings, saved activity, and viewing diary
│   ├── lists/                 Personal and shared collections
│   ├── messages/              Conversations, streams, encryption, and membership
│   ├── notifications/         User notification state
│   ├── social/                Feed, relationships, reviews, comments, and likes
│   ├── support/               Support delivery workflows
│   ├── tmdb/                  Protected catalog client and endpoints
│   ├── watchParty/            Rooms, persistence, services, and WebSocket gateway
│   └── watchProgress/         Browser-extension pairing and playback progress
├── routes/                    Top-level API composition
├── shared/                    Validation, middleware, caching, errors, logging, and utilities
├── app.js                     Express application pipeline
└── server.js                  HTTP server and real-time service bootstrap
```

## Technology

- Node.js
- Express 5
- Firebase Admin SDK
- Cloud Firestore and Firebase Realtime Database
- PostgreSQL with `pg`
- WebSockets with `ws`
- Server-Sent Events
- Zod
- Axios
- Helmet, CORS, cookie-parser, and express-rate-limit
- AES-256-GCM encryption through the Node.js Crypto API
- Winston
- Jest and Supertest

## Project status

CineSorte Backend is under active development and currently supports the production-facing CineSorte experience. Its modular structure allows authentication, catalog discovery, social features, messaging, extension synchronization, and watch parties to evolve independently while sharing a consistent security and error-handling foundation.

> This product uses the TMDB API but is not endorsed or certified by TMDB.

<div align="center">
  Built by <a href="https://brianlucca.vercel.app/">Brian Lucca</a>
</div>
