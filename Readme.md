<div align="center">

<h1>🚑 RapidAid</h1>

<p><strong>Real-time AI-powered emergency ambulance dispatch & coordination system</strong></p>

<p>
  <img src="https://img.shields.io/badge/Node.js-18.x-339933?style=flat-square&logo=node.js&logoColor=white"/>
  <img src="https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express&logoColor=white"/>
  <img src="https://img.shields.io/badge/MongoDB-Atlas-47A248?style=flat-square&logo=mongodb&logoColor=white"/>
  <img src="https://img.shields.io/badge/Redis-Upstash-DC382D?style=flat-square&logo=redis&logoColor=white"/>
  <img src="https://img.shields.io/badge/Socket.io-4.x-010101?style=flat-square&logo=socket.io&logoColor=white"/>
  <img src="https://img.shields.io/badge/Groq-LLaMA_3-F55036?style=flat-square"/>
  <img src="https://img.shields.io/badge/React-18.x-61DAFB?style=flat-square&logo=react&logoColor=black"/>
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square"/>
</p>

<p>
  <a href="#-architecture">Architecture</a> •
  <a href="#-features">Features</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-api-reference">API Reference</a> •
  <a href="#-deployment">Deployment</a>
</p>

</div>

---

## The Problem

In India, **~50% of accident victims die due to delayed medical response**. The existing emergency infrastructure has no real-time tracking, no communication channel between patients and drivers, and no intelligent fallback when an ambulance is stuck. Every minute of delay increases mortality risk significantly.

RapidAid solves this by building a production-grade dispatch engine that assigns ambulances in **under 300ms**, tracks them live via WebSockets, and automatically detects and handles delays through a 4-level fallback system powered by AI.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                               │
│   React + Vite (Patient App)          React + Vite (Driver App)     │
│   Mapbox GL JS · Socket.io Client     Socket.io Client · Location   │
└────────────────────────┬──────────────────────┬─────────────────────┘
                         │  HTTPS / WSS          │
┌────────────────────────▼──────────────────────▼─────────────────────┐
│                        API GATEWAY (Nginx)                          │
│              Load Balancing · SSL Termination · Rate Limiting        │
└────────────────────────────────────┬────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────┐
│                     STATELESS NODE.js CLUSTER                       │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Auth Service │  │  Emergency   │  │    Socket.io Server      │  │
│  │ JWT · bcrypt │  │  Controller  │  │   Redis Adapter (rooms)  │  │
│  └──────────────┘  └──────┬───────┘  └──────────────────────────┘  │
│                           │                                         │
│  ┌──────────────┐  ┌──────▼───────┐  ┌──────────────────────────┐  │
│  │  Assignment  │  │    Delay     │  │       AI Service         │  │
│  │  Algorithm   │  │  Detection   │  │   Groq LLaMA 3 · Triage  │  │
│  │  <300ms SLA  │  │  Bull Worker │  │   Hospital Selection     │  │
│  └──────┬───────┘  └──────────────┘  └──────────────────────────┘  │
└─────────┼───────────────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────────────┐
│                          DATA LAYER                                 │
│                                                                     │
│   ┌─────────────────┐          ┌──────────────────────────────┐    │
│   │   MongoDB Atlas  │          │        Redis (Upstash)       │    │
│   │                  │          │                              │    │
│   │  EmergencySession│          │  ambulance:{id}:status       │    │
│   │  User            │          │  ambulance:{id}:location     │    │
│   │  Ambulance       │          │  session:{id}:eta            │    │
│   │  Hospital        │          │  session:{id}:expectedEta    │    │
│   │  ChatMessage     │          │  TTL: 2 hours per key        │    │
│   └─────────────────┘          └──────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Emergency Session State Machine

Every emergency is modeled as a **session** with explicit state transitions. Every transition is persisted to an event log — enabling auditing, analytics, and future ML training data.

```
  ┌───────────┐    assign     ┌───────────┐    driver moves   ┌──────────┐
  │ INITIATED │ ────────────► │ ASSIGNED  │ ───────────────►  │ EN_ROUTE │
  └───────────┘               └───────────┘                   └────┬─────┘
                                                                    │
                                                    drift > 3 min   │
                                                    ┌───────────────▼──┐
                                                    │    DELAYED       │
                                                    │  fallback fires  │
                                                    └───────────────┬──┘
                                                                    │
                                                    ┌───────────────▼──┐
                                                    │    RESOLVED      │
                                                    └──────────────────┘
```

### Delay Detection & Fallback

```
Bull Worker (every 60s per session)
       │
       ▼
  Compare live ETA vs expected ETA
       │
   drift > 3 min?
       │
       ├── Level 1 ──► Reroute current ambulance (Maps API alternatives)
       │
       ├── Level 2 ──► Swap to closer available ambulance (if ETA gain > 2 min)
       │
       ├── Level 3 ──► AI generates plain-language alternative for patient
       │
       └── Level 4 ──► Notify hospital emergency desk via webhook
```

---

## Features

### Core Engine
- **Sub-300ms ambulance assignment** — Redis O(1) availability reads + weighted scoring (distance 50%, ETA 30%, workload 20%)
- **Real-time GPS tracking** — Socket.io rooms per session, location updates every 4s with delta compression (broadcasts only if moved >10m)
- **Proactive delay detection** — background Bull worker comparing live vs expected ETA continuously
- **4-level fallback orchestration** — reroute → swap → AI suggestion → hospital webhook

### AI Layer (Groq LLaMA 3)
- **Severity triage** — classifies emergency 1–5 from natural language description, returns structured JSON
- **Intelligent hospital selection** — weighs severity + distance + specialization + bed availability + time of day
- **Contextual fallback suggestions** — not hardcoded, generated per session context
- **First-aid auto-delivery** — severity 4–5 triggers immediate first-aid instructions to patient via chat
- **Driver quick-replies** — AI suggests 3 responses per patient message so the driver doesn't type while driving

### Infrastructure
- **Horizontally scalable** — stateless backend with Socket.io Redis adapter; any instance handles any request
- **Geo-partitioned assignment** — city zones reduce ambulance search space by ~90% under load
- **Full observability** — Winston structured logging, event log on every state transition, operational metrics
- **Graceful degradation** — WebSocket disconnect preserves last known location in Redis for 5 minutes

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| **Backend** | Node.js 18 + Express 4 | Non-blocking I/O handles WebSocket + REST under high concurrency |
| **Real-time** | Socket.io 4 | Rooms per session; Redis adapter enables horizontal scaling |
| **Primary DB** | MongoDB Atlas | Flexible document schema for emergency sessions + GeoJSON support |
| **State Cache** | Redis (Upstash) | O(1) ambulance availability reads; shared state across instances |
| **Job Queue** | Bull | Redis-backed background workers for delay detection |
| **AI** | Groq API (LLaMA 3.3 70B) | Fast inference (<300ms) for real-time triage decisions |
| **Maps** | Google Maps Platform | Real ETA with traffic, route alternatives, geocoding |
| **Auth** | JWT + bcrypt | Stateless access (15m) + refresh (7d) token pattern |
| **Validation** | express-validator | Schema validation on all incoming request bodies |
| **Logging** | Winston | Structured JSON logs; level-gated by environment |
| **Frontend** | React 18 + Vite | Fast HMR in dev; optimized production bundle |
| **Maps UI** | Mapbox GL JS | Smooth real-time marker updates without full re-renders |
| **Deployment** | Railway + Vercel | Zero-config deploys; environment variable injection |

---

## Project Structure

```
rapidaid/
│
├── backend/
│   ├── src/
│   │   │
│   │   ├── config/
│   │   │   ├── db.js                  # Mongoose connection with retry logic
│   │   │   └── redis.js               # ioredis client with reconnect strategy
│   │   │
│   │   ├── models/
│   │   │   ├── user.model.js          # User schema (bcrypt pre-save hook)
│   │   │   ├── emergency.model.js     # Session schema + eventLog + state enum
│   │   │   ├── ambulance.model.js     # GeoJSON location + availability state
│   │   │   ├── hospital.model.js      # Capacity, specializations, GeoJSON
│   │   │   └── message.model.js       # Driver-patient chat messages
│   │   │
│   │   ├── routes/
│   │   │   ├── auth.routes.js         # POST /register, /login, /refresh, /logout
│   │   │   ├── emergency.routes.js    # POST /trigger, GET /:id, PATCH /:id/status
│   │   │   ├── ambulance.routes.js    # CRUD + availability + location update
│   │   │   └── hospital.routes.js     # CRUD + bed availability update
│   │   │
│   │   ├── controllers/
│   │   │   ├── auth.controller.js     # Register, login, token refresh logic
│   │   │   ├── emergency.controller.js# Trigger flow, session fetch, status patch
│   │   │   ├── ambulance.controller.js# Availability management, location ping
│   │   │   └── hospital.controller.js # Hospital CRUD, capacity management
│   │   │
│   │   ├── services/
│   │   │   ├── assignment.service.js  # Weighted ambulance scoring algorithm
│   │   │   ├── delay.service.js       # ETA drift calculation + fallback trigger
│   │   │   ├── fallback.service.js    # 4-level fallback orchestration
│   │   │   ├── ai.service.js          # Groq API — triage, hospital select, suggestions
│   │   │   └── maps.service.js        # Google Maps ETA, routing, geocoding
│   │   │
│   │   ├── workers/
│   │   │   └── delayDetection.worker.js  # Bull job — runs every 60s per active session
│   │   │
│   │   ├── sockets/
│   │   │   ├── index.js               # Socket.io init + Redis adapter setup
│   │   │   ├── emergencyRoom.js       # Room join/leave, location broadcast, chat
│   │   │   └── events.js              # Event name constants
│   │   │
│   │   ├── middleware/
│   │   │   ├── auth.middleware.js     # JWT verify + req.user injection
│   │   │   ├── role.middleware.js     # Role-based access (USER / DRIVER / ADMIN)
│   │   │   ├── rateLimit.middleware.js# Per-route rate limiters
│   │   │   └── error.middleware.js    # Centralized error handler
│   │   │
│   │   ├── utils/
│   │   │   ├── logger.js              # Winston logger (debug in dev, info in prod)
│   │   │   ├── apiError.js            # Custom error class with statusCode
│   │   │   └── geohash.js             # Geohash utilities for zone partitioning
│   │   │
│   │   ├── app.js                     # Express setup — middleware stack, routes
│   │   └── server.js                  # HTTP server + Socket.io + connectDB entry
│   │
│   ├── .env.example
│   ├── .gitignore
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── Map/                   # Mapbox GL wrapper + live marker updates
    │   │   ├── EmergencyTrigger/      # One-button trigger + severity description
    │   │   ├── TrackingPanel/         # ETA, driver info, status updates
    │   │   ├── Chat/                  # Real-time patient-driver chat
    │   │   └── FallbackAlert/         # AI fallback suggestion display
    │   │
    │   ├── hooks/
    │   │   ├── useSocket.js           # Socket.io connection lifecycle
    │   │   ├── useLocation.js         # Browser geolocation with error handling
    │   │   └── useEmergency.js        # Session state management
    │   │
    │   ├── services/
    │   │   └── api.js                 # Axios instance with JWT interceptors
    │   │
    │   ├── store/                     # Zustand global state
    │   └── main.jsx
    │
    ├── .env.example
    └── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB Atlas account (free tier works)
- Upstash Redis account (free tier works)
- Google Maps API key (enable Maps JavaScript API + Directions API + Geocoding API)
- Groq API key

### 1. Clone the repository

```bash
git clone https://github.com/SHUBHANSHU602/rapidaid.git
cd rapidaid
```

### 2. Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Fill in your `.env`:

```env
# Server
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/rapidaid

# Redis
REDIS_URL=rediss://<upstash-url>

# Auth
JWT_SECRET=your_jwt_secret_minimum_32_characters
JWT_REFRESH_SECRET=your_refresh_secret_minimum_32_characters
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# AI
GROQ_API_KEY=your_groq_api_key

# Maps
MAPS_API_KEY=your_google_maps_api_key

# Client
CLIENT_URL=http://localhost:5173
```

```bash
npm run dev
```

Server starts on `http://localhost:5000`. Verify: `GET /health` returns `{ "status": "ok" }`.

### 3. Frontend setup

```bash
cd ../frontend
npm install
cp .env.example .env
```

```env
VITE_API_URL=http://localhost:5000
VITE_MAPBOX_TOKEN=your_mapbox_public_token
```

```bash
npm run dev
```

Frontend starts on `http://localhost:5173`.

---

## API Reference

### Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | ✗ | Register new user |
| `POST` | `/api/auth/login` | ✗ | Login, returns access + refresh tokens |
| `POST` | `/api/auth/refresh` | ✗ | Refresh access token |
| `POST` | `/api/auth/logout` | ✓ | Invalidate refresh token |

### Emergency

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/emergency/trigger` | USER | Trigger emergency, starts assignment flow |
| `GET` | `/api/emergency/:id` | USER/ADMIN | Get session by ID |
| `PATCH` | `/api/emergency/:id/status` | DRIVER/ADMIN | Update session status |
| `GET` | `/api/emergency/active` | ADMIN | All active sessions |

### Ambulance

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/ambulance` | ADMIN | List all ambulances |
| `POST` | `/api/ambulance` | ADMIN | Register new ambulance |
| `PATCH` | `/api/ambulance/:id/location` | DRIVER | Update current location |
| `PATCH` | `/api/ambulance/:id/status` | DRIVER | Toggle availability |

### WebSocket Events

```
CLIENT → SERVER
  emergency:join         { sessionId }           Join emergency room
  location:update        { lat, lng, sessionId } Driver location ping
  chat:message           { sessionId, text }      Send chat message

SERVER → CLIENT
  location:broadcast     { lat, lng, timestamp }  Live driver position
  eta:update             { eta, expectedArrival }  ETA recalculation
  session:status         { status }               State transition
  fallback:triggered     { level, suggestion }    Fallback activated
  chat:message           { senderId, text, time } Incoming message
```

### Request & Response Examples

**Trigger Emergency**
```bash
POST /api/emergency/trigger
Authorization: Bearer <access_token>

{
  "location": { "lat": 28.6139, "lng": 77.2090 },
  "emergencyType": "cardiac",
  "description": "Old man collapsed, not breathing, turning blue"
}
```

```json
{
  "success": true,
  "data": {
    "sessionId": "64f8a2...",
    "status": "ASSIGNED",
    "ambulance": {
      "id": "64f7b1...",
      "driverName": "Rajesh Kumar",
      "licensePlate": "DL 01 AB 1234",
      "currentLocation": { "lat": 28.6121, "lng": 77.2075 },
      "eta": 420000
    },
    "hospital": {
      "name": "Apollo Hospital Dwarka",
      "distance": "3.2 km",
      "specialization": "Cardiac ICU"
    },
    "severity": 5,
    "aiTriage": {
      "category": "cardiac_arrest",
      "requiresSpecialist": true,
      "firstAidSent": true
    }
  }
}
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: 5000) |
| `NODE_ENV` | Yes | `development` or `production` |
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `REDIS_URL` | Yes | Redis connection URL |
| `JWT_SECRET` | Yes | Min 32 chars, used for access tokens |
| `JWT_REFRESH_SECRET` | Yes | Min 32 chars, used for refresh tokens |
| `JWT_EXPIRES_IN` | No | Access token TTL (default: 15m) |
| `JWT_REFRESH_EXPIRES_IN` | No | Refresh token TTL (default: 7d) |
| `GROQ_API_KEY` | Yes | Groq API key for LLaMA inference |
| `MAPS_API_KEY` | Yes | Google Maps Platform API key |
| `CLIENT_URL` | Yes | Frontend origin for CORS |

---

## Deployment

### Backend → Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

railway login
railway init
railway up
```

Set all environment variables in the Railway dashboard under **Variables**.

### Frontend → Vercel

```bash
npm install -g vercel
cd frontend
vercel --prod
```

Set `VITE_API_URL` to your Railway backend URL in Vercel project settings.

### Redis → Upstash

1. Create a Redis database at [upstash.com](https://upstash.com)
2. Copy the `REDIS_URL` (starts with `rediss://`)
3. Paste into Railway environment variables

### MongoDB → Atlas

1. Create a free M0 cluster at [mongodb.com/atlas](https://mongodb.com/atlas)
2. Create a database user and whitelist `0.0.0.0/0` for Railway's dynamic IPs
3. Copy the connection string into `MONGODB_URI`

---

## Key Design Decisions

**Why Redis for ambulance state instead of MongoDB?**
Ambulance location and availability are read on every assignment request and every WebSocket ping. MongoDB adds network round-trip overhead. Redis gives sub-millisecond reads in-memory. MongoDB is only written to on state change events — not every 4-second location ping.

**Why Bull for delay detection instead of setInterval?**
`setInterval` in Node.js is not reliable under load and doesn't survive process restarts. Bull persists jobs in Redis, prevents duplicate workers across multiple instances, and supports retry logic with exponential backoff.

**Why stateless JWT instead of server-side sessions?**
Sessions require sticky routing or a shared session store. JWT lets any server instance validate any request independently — critical for horizontal scaling behind a load balancer.

**Why a 4-level fallback instead of one fallback action?**
Real emergencies are not binary. Sometimes a reroute is enough. Sometimes you need to swap the ambulance entirely. Sometimes no ambulance is available at all. Layered fallback means the system always has a next action rather than failing silently.

---

## Performance Targets

| Metric | Target |
|---|---|
| Ambulance assignment latency | < 300ms |
| Location broadcast delay | < 200ms |
| Delay detection interval | 60 seconds |
| Delay drift threshold | 3 minutes |
| Redis key TTL | 2 hours |
| WebSocket reconnect window | 5 minutes |

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">
  <p>Built by <a href="https://github.com/SHUBHANSHU602">Shubhanshu Singh</a></p>
  <p><sub>If this saved you time, leave a ⭐</sub></p>
</div>
