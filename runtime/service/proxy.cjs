// Route discord.js Gateway through Node's environment proxy without disabling TLS verification.
// Load with node --use-env-proxy --require this-file server.mjs.
const https = require('node:https');
const http = require('node:http');
const { createRequire } = require('node:module');
const discordRequire = createRequire(require.resolve('discord.js'));
const gatewayRequire = createRequire(discordRequire.resolve('@discordjs/ws'));
const wsPath = gatewayRequire.resolve('ws');
const WebSocket = require(wsPath);
class ProxyWebSocket extends WebSocket {
  constructor(address, protocols, options) {
    if (protocols && typeof protocols === 'object' && !Array.isArray(protocols)) {
      options = protocols;
      protocols = undefined;
    }
    const configured = { ...options };
    if (configured.agent === undefined) {
      configured.agent = String(address).startsWith('wss:') ? https.globalAgent : http.globalAgent;
    }
    super(address, protocols, configured);
  }
}
Object.defineProperty(ProxyWebSocket, 'WebSocket', { value: ProxyWebSocket });
require.cache[wsPath].exports = ProxyWebSocket;
