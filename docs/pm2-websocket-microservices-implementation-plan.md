# PM2 and WebSocket Microservices Architecture Report

This document captures the architecture pattern described in the attached report and turns it into an implementation plan for the Dooriq codebase.

## Goal

Split the application into separate runtime processes so that:

- REST APIs can scale horizontally with PM2 cluster mode.
- WebSocket connections stay stable in a single dedicated socket process.
- Redis acts as the bridge between API workers, socket workers, and background jobs.

## Architecture Overview

The runtime should be divided into specialized services:

1. API Server
   - Handles HTTP/REST traffic.
   - Runs in PM2 `cluster` mode.
   - Can scale across CPU cores.

2. Socket Server
   - Handles WebSocket connections.
   - Runs in PM2 `fork` mode as a single instance.
   - Avoids socket-state problems caused by cluster rebalancing.

3. Background Workers
   - Handle queues, schedulers, notifications, and asynchronous processing.
   - Can run as separate PM2 processes.

4. Redis Bridge
   - Carries socket events between services.
   - Supports pub/sub for event emission and fan-out.
   - Required for cross-process real-time updates.

## Core Runtime Contract

### API Server

- Accepts HTTP requests.
- Does not own long-lived WebSocket connections.
- Emits socket events through a Redis-backed emitter.

### Socket Server

- Accepts client socket connections directly.
- Uses a Redis adapter so events emitted elsewhere still reach connected clients.
- Remains a single process to preserve connection affinity.

### Shared Socket Interface

The codebase should expose a single wrapper such as `getIO()` so callers do not need to know whether they are running inside:

- the API process,
- the socket process, or
- a worker process.

If the full socket server is available, `getIO()` returns the real Socket.IO server.
If not, it returns a Redis emitter or a safe no-op fallback.

## PM2 Process Layout

Suggested process list:

- `indian-foods-api`
  - `exec_mode: cluster`
  - `instances: max`
  - entry point: `server.js`

- `indian-foods-socket`
  - `exec_mode: fork`
  - `instances: 1`
  - entry point: `socket-server.js`

- `indian-foods-scheduler`
  - `exec_mode: fork`
  - `instances: 1`
  - entry point: `scheduler-server.js`

- Optional workers
  - OTP worker
  - notification worker
  - order worker
  - payment worker
  - tracking worker

## Port and Environment Strategy

Use separate ports to prevent conflicts:

- `PORT` for REST API traffic.
- `SOCKET_PORT` for WebSocket traffic.

Recommended env vars:

- `PORT=5000`
- `SOCKET_PORT=5001`
- `REDIS_ENABLED=true`
- `REDIS_URL=redis://localhost:6379`

## Communication Flow

1. Client hits an API endpoint.
2. API handler processes the request.
3. Business logic calls `getIO().emit(...)` or `getIO().to('room').emit(...)`.
4. In the API process, the call is published to Redis.
5. The socket process subscribes through the Redis adapter.
6. Connected clients receive the event in real time.

## Implementation Plan

### Phase 1: Inventory and separation

- Identify all places that currently initialize Socket.IO directly inside the API server.
- Move socket initialization into a dedicated socket entry point.
- Confirm which events are emitted from controllers, services, and workers.

### Phase 2: Shared socket configuration

- Create or standardize a shared `src/config/socket.js`.
- Implement:
  - socket server bootstrap
  - Redis adapter setup
  - Redis emitter setup
  - `getIO()` wrapper
- Make sure the API process can emit without opening socket connections.

### Phase 3: PM2 ecosystem

- Add or update `ecosystem.config.cjs`.
- Configure the API in cluster mode.
- Configure the socket server in fork mode.
- Add any worker processes that the application needs.
- Add restart and environment rules.

### Phase 4: Environment and deployment

- Add the new ports to `.env.example` if available.
- Ensure Redis is available in local, staging, and production environments.
- Confirm the deploy target can start multiple PM2 processes.

### Phase 5: Event routing

- Replace direct in-process socket calls with `getIO()`.
- Emit all real-time events through the shared interface.
- Verify that queue workers can also emit safely.

### Phase 6: Verification

- Test REST endpoints under clustered load.
- Connect a WebSocket client and confirm events arrive.
- Restart the API process and verify socket connections remain stable.
- Restart the socket process and verify clients reconnect cleanly.

### Phase 7: Observability and safety

- Add structured logs around:
  - process startup
  - Redis connection state
  - socket connection/disconnection
  - emitted events
- Add health endpoints for API and socket services.
- Document failure modes and recovery steps.

## Acceptance Criteria

- API traffic can scale horizontally with PM2.
- WebSocket clients stay connected to a single dedicated socket process.
- Events emitted from API controllers and workers reach connected clients.
- Redis is the only cross-process bridge required for sockets.
- Restarting one service does not break the entire real-time layer.

## Risks and Notes

- Running sockets inside cluster mode can create connection affinity bugs.
- Redis is a hard dependency for cross-process event delivery.
- Any code that calls `getIO()` must tolerate the no-op fallback during startup or test runs.
- Background workers should emit through the shared interface rather than importing socket internals directly.

## Rollout Checklist

- [ ] Create the shared socket config.
- [ ] Add the PM2 ecosystem file.
- [ ] Split API and socket entry points.
- [ ] Move real-time emissions to the shared wrapper.
- [ ] Verify Redis pub/sub in development.
- [ ] Test one API request-to-socket event end-to-end.
- [ ] Confirm production restart behavior.

## Next Step

Implement the socket split in the current Dooriq backend, then wire every existing real-time emission through the shared `getIO()` interface.
