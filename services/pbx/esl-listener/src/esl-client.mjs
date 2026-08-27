import { EventEmitter } from 'node:events';
import net from 'node:net';

function headerSeparator(buffer) {
  const crlf = buffer.indexOf('\r\n\r\n');
  const lf = buffer.indexOf('\n\n');
  if (crlf === -1) return lf === -1 ? null : { index: lf, length: 2 };
  if (lf === -1 || crlf < lf) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function parseHeaders(value) {
  const headers = {};
  for (const line of value.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const raw = line.slice(separator + 1).trim();
    try {
      headers[line.slice(0, separator).trim().toLowerCase()] = decodeURIComponent(raw);
    } catch {
      headers[line.slice(0, separator).trim().toLowerCase()] = raw;
    }
  }
  return headers;
}

export class EslFrameParser {
  #buffer = Buffer.alloc(0);

  push(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const frames = [];
    while (this.#buffer.length) {
      const separator = headerSeparator(this.#buffer);
      if (!separator) break;
      const headers = parseHeaders(this.#buffer.subarray(0, separator.index).toString('utf8'));
      const contentLength = Number(headers['content-length'] || 0);
      if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > 8 * 1024 * 1024) {
        throw new Error('FreeSWITCH sent an invalid ESL Content-Length.');
      }
      const bodyStart = separator.index + separator.length;
      if (this.#buffer.length < bodyStart + contentLength) break;
      const body = this.#buffer.subarray(bodyStart, bodyStart + contentLength).toString('utf8');
      frames.push({ headers, body });
      this.#buffer = this.#buffer.subarray(bodyStart + contentLength);
    }
    return frames;
  }
}

export class EslClient extends EventEmitter {
  #config;
  #socket = null;
  #parser = new EslFrameParser();
  #reconnectTimer = null;
  #attempt = 0;
  #stopped = false;
  #authenticated = false;

  constructor(config) {
    super();
    this.#config = config;
  }

  get connected() {
    return Boolean(this.#socket && !this.#socket.destroyed && this.#authenticated);
  }

  start() {
    this.#stopped = false;
    this.#connect();
  }

  stop() {
    this.#stopped = true;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#socket?.destroy();
    this.#socket = null;
    this.#authenticated = false;
  }

  command(value) {
    if (!this.#socket || this.#socket.destroyed) throw new Error('ESL is not connected.');
    this.#socket.write(`${value.trim()}\n\n`);
  }

  #connect() {
    if (this.#stopped || this.#socket) return;
    this.#parser = new EslFrameParser();
    const socket = net.createConnection({ host: this.#config.host, port: this.#config.port });
    this.#socket = socket;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);
    socket.on('connect', () => this.emit('transportConnected'));
    socket.on('data', (chunk) => {
      try {
        for (const frame of this.#parser.push(chunk)) this.#frame(frame);
      } catch (error) {
        this.emit('error', error);
        socket.destroy();
      }
    });
    socket.on('error', (error) => this.emit('transportError', error));
    socket.on('close', () => {
      if (this.#socket === socket) this.#socket = null;
      const wasAuthenticated = this.#authenticated;
      this.#authenticated = false;
      this.emit('disconnected', { wasAuthenticated });
      this.#scheduleReconnect();
    });
  }

  #frame(frame) {
    const contentType = frame.headers['content-type'];
    if (contentType === 'auth/request') {
      this.command(`auth ${this.#config.password}`);
      return;
    }
    if (contentType === 'command/reply' && !this.#authenticated) {
      if (!frame.headers['reply-text']?.startsWith('+OK')) {
        this.emit('error', new Error('FreeSWITCH rejected the ESL password.'));
        this.#socket?.destroy();
        return;
      }
      this.#authenticated = true;
      this.#attempt = 0;
      this.command('event json CHANNEL_CREATE CHANNEL_PROGRESS CHANNEL_PROGRESS_MEDIA CHANNEL_ANSWER CHANNEL_HANGUP_COMPLETE DTMF CUSTOM sofia::register sofia::unregister sofia::expire');
      this.emit('ready');
      return;
    }
    if (contentType !== 'text/event-json') return;
    try {
      this.emit('event', JSON.parse(frame.body));
    } catch {
      this.emit('error', new Error('FreeSWITCH sent malformed JSON event data.'));
    }
  }

  #scheduleReconnect() {
    if (this.#stopped || this.#reconnectTimer) return;
    const exponential = Math.min(this.#config.reconnectMaximumMs, this.#config.reconnectMinimumMs * 2 ** this.#attempt);
    const delay = Math.round(exponential * (0.8 + Math.random() * 0.4));
    this.#attempt = Math.min(this.#attempt + 1, 20);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delay);
    this.#reconnectTimer.unref?.();
  }
}
