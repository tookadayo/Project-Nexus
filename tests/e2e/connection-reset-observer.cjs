/* global process, Buffer, require */
/* eslint-disable @typescript-eslint/no-require-imports -- Node --require loads this isolated E2E preload as CommonJS. */
'use strict';

// Opt-in diagnostics for the synthetic main E2E CI step, never a runtime handler.
if (process.env.CI === 'true' && process.env.NEXUS_E2E_CONNECTION_RESET_OBSERVE === '1' &&
    !globalThis[Symbol.for('nexus.e2e.connectionResetObserver')]) {
  globalThis[Symbol.for('nexus.e2e.connectionResetObserver')] = true;
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  const http = require('node:http');
  const {EventEmitter} = require('node:events');
  const {threadId} = require('node:worker_threads');
  const observerInstanceId = crypto.randomUUID(), startedAt = new Date().toISOString();
  const originalEmit = EventEmitter.prototype.emit;
  const originalListenerCount = EventEmitter.prototype.listenerCount;
  const descriptor = Object.getOwnPropertyDescriptor(EventEmitter.prototype, 'emit');
  const errors = new WeakMap(), requests = new WeakMap(), errorContexts = new WeakMap();
  const limits = {error: 1000, uncaught: 200, lifecycle: 2000};
  const written = {error: 0, uncaught: 0, lifecycle: 0};
  const dropped = {error: 0, uncaught: 0, lifecycle: 0, output: 0};
  let errorSequence = 0, requestSequence = 0, sequence = 0, recording = false;
  const argv = process.argv.map(value => value.replaceAll('\\', '/'));
  const role = argv.some(value => value.includes('/next/dist/')) ?
    (process.env.NODE_ENV === 'production' ? 'next_production' : 'next_development') :
    argv.some(value => value.endsWith('/alpha17-verification-web.ts')) ? 'synthetic_tls_front' :
    argv.some(value => value.endsWith('/tests/e2e/server.ts')) ? 'synthetic_api' :
    argv.some(value => value.includes('playwright')) ? 'playwright' : 'other_e2e_node';
  const own = (value, key) => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
    const property = Object.getOwnPropertyDescriptor(value, key);
    return property && Object.hasOwn(property, 'value') ? property.value : undefined;
  };
  const errorData = error => {
    if (error !== null && (typeof error === 'object' || typeof error === 'function') && !errors.has(error)) errors.set(error, ++errorSequence);
    const message = own(error, 'message');
    return {errorId: errors.get(error) ?? null, code: own(error, 'code') === 'ECONNRESET' ? 'ECONNRESET' : null,
      messageClass: message === 'aborted' ? 'aborted' : message === 'read ECONNRESET' ? 'read_ECONNRESET' : 'other'};
  };
  const method = value => ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT'].includes(value) ? value : null;
  const port = value => Number.isInteger(value) && value > 0 && value <= 65535 ? value : null;
  const route = value => {
    if (typeof value !== 'string') return {routeClass: null, pathnameSha256: null};
    const pathname = value.split('?', 1)[0].split('#', 1)[0];
    return {routeClass: ['/', '/dashboard', '/control', '/auth/select', '/data/journey', '/data/community', '/health'].includes(pathname) ? pathname :
      pathname.startsWith('/_next/') ? 'next_asset' : 'other', pathnameSha256: crypto.createHash('sha256').update(pathname).digest('hex')};
  };
  const context = incoming => {
    const previous = requests.get(incoming) ?? {requestId: ++requestSequence, firstObservedAt: new Date().toISOString()};
    const client = incoming.req instanceof http.ClientRequest ? incoming.req : null;
    const socket = incoming.socket;
    const current = {...previous, direction: client ? 'client_incoming_response' : method(own(incoming, 'method')) ? 'server_incoming_request' : 'incoming_unknown',
      method: method(client ? own(client, 'method') : own(incoming, 'method')),
      ...route(client ? own(client, 'path') : own(incoming, 'url')),
      localPort: port(socket?.localPort) ?? previous.localPort ?? null, remotePort: port(socket?.remotePort) ?? previous.remotePort ?? null,
      complete: Boolean(incoming.complete), readableEnded: Boolean(incoming.readableEnded), aborted: Boolean(incoming.aborted),
      readableAborted: Boolean(incoming.readableAborted), destroyed: Boolean(incoming.destroyed)};
    requests.set(incoming, current);
    return current;
  };
  const constructorName = value => {
    const prototype = Object.getPrototypeOf(value), constructor = prototype && own(prototype, 'constructor'), name = own(constructor, 'name');
    return ['IncomingMessage', 'ClientRequest', 'ServerResponse', 'Socket', 'TLSSocket', 'PassThrough',
      'Transform', 'Readable', 'Writable', 'Duplex', 'EventEmitter', 'process'].includes(name) ? name : 'other';
  };
  const write = row => {
    try {
      const line = 'NEXUS_E2E_RESET ' + JSON.stringify({at: new Date().toISOString(), pid: process.pid, threadId, observerInstanceId, startedAt, role, sequence: ++sequence, ...row}) + '\n';
      if (Buffer.byteLength(line) > 2048 || fs.writeSync(2, line) !== Buffer.byteLength(line)) dropped.output++;
    } catch { dropped.output++; }
  };
  const record = (budget, row) => {
    if (recording || written[budget] >= limits[budget]) { dropped[budget]++; return; }
    recording = true;
    try { written[budget]++; write(row); } finally { recording = false; }
  };
  function observedEmit(event) {
    // Only observation failures are caught. Original emit keeps its own throw.
    try {
      if (event === 'request' && arguments[1] instanceof http.IncomingMessage) context(arguments[1]);
      else if (event === 'response' && this instanceof http.ClientRequest && arguments[1] instanceof http.IncomingMessage) context(arguments[1]);
      const error = arguments[1], data = event === 'error' ? errorData(error) : null;
      if (event === 'error' && data.code === 'ECONNRESET' && data.messageClass !== 'other') {
        const request = this instanceof http.IncomingMessage ? context(this) : errorContexts.get(error) ?? null;
        if (request) errorContexts.set(error, request);
        record('error', {kind: 'emitter_error', constructor: constructorName(this), errorListenerCount: Reflect.apply(originalListenerCount, this, ['error']), ...data, request});
      } else if (event === 'aborted' && this instanceof http.IncomingMessage) {
        record('lifecycle', {kind: 'incoming_aborted', constructor: constructorName(this), errorListenerCount: Reflect.apply(originalListenerCount, this, ['error']), request: context(this)});
      } else if (event === 'close' && this instanceof http.ServerResponse) {
        const request = this.req instanceof http.IncomingMessage ? context(this.req) : null;
        // Include normal TLS-front close so its existing upstream.destroy can be
        // correlated. Other completed responses add no rows.
        if (!this.writableFinished || request?.localPort === 3150) record('lifecycle', {kind: 'server_response_close',
          writableFinished: Boolean(this.writableFinished), destroyed: Boolean(this.destroyed),
          status: Number.isInteger(this.statusCode) ? this.statusCode : null, request});
      }
    } catch { /* Never replace original event behavior. */ }
    return Reflect.apply(originalEmit, this, arguments);
  }
  Object.defineProperty(EventEmitter.prototype, 'emit', {...descriptor, value: observedEmit});
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    try { record('uncaught', {kind: 'uncaught_exception_monitor', ...errorData(error),
      origin: origin === 'uncaughtException' || origin === 'unhandledRejection' ? origin : 'other',
      uncaughtExceptionListenerCount: process.listenerCount('uncaughtException'),
      request: errorContexts.get(error) ?? null}); } catch { /* Observation only. */ }
  });
  record('lifecycle', {kind: 'observer_installed', limits});
  process.once('exit', code => {
    if (recording) return;
    recording = true;
    try { write({kind: 'observer_summary', exitCode: code, written, dropped}); } finally { recording = false; }
  });
}
