#!/usr/bin/env node
/**
 * TCP tunnel: 127.0.0.1:15432 -> Neon:5432 through the box HTTP CONNECT proxy.
 * No database credentials are handled or logged here.
 */
import net from 'node:net';

const listenHost = process.env.NEON_TUNNEL_LISTEN || '127.0.0.1';
const listenPort = Number(process.env.NEON_TUNNEL_PORT || 15432);
const proxyHost = process.env.NEON_TUNNEL_PROXY || '127.0.0.1';
const proxyPort = Number(process.env.NEON_TUNNEL_PROXY_PORT || 8791);
const targetHost = process.env.NEON_TUNNEL_HOST || 'ep-mute-mode-bdjsbdzj.c-8.us-east-2.aws.neon.tech';
const targetPort = Number(process.env.NEON_TUNNEL_TARGET_PORT || 5432);

function connectThroughProxy() {
  return new Promise((resolve, reject) => {
    const upstream = net.createConnection({ host: proxyHost, port: proxyPort });
    let response = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => fail(new Error('proxy CONNECT timed out')), 15_000);

    function cleanup() {
      clearTimeout(timer);
      upstream.off('error', onError);
    }
    function fail(error) {
      if (settled) return;
      settled = true;
      cleanup();
      upstream.destroy();
      reject(error);
    }
    function onError(error) { fail(error); }

    upstream.once('error', onError);
    upstream.once('connect', () => {
      upstream.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`,
      );
    });
    upstream.on('data', function onResponse(chunk) {
      response = Buffer.concat([response, chunk]);
      const end = response.indexOf('\r\n\r\n');
      if (end < 0) {
        if (response.length > 16 * 1024) fail(new Error('proxy CONNECT response headers too large'));
        return;
      }
      upstream.off('data', onResponse);
      const header = response.subarray(0, end).toString('latin1');
      const status = header.split('\r\n', 1)[0] || '';
      if (!/^HTTP\/1\.[01] 200(?:\s|$)/.test(status)) {
        fail(new Error(`proxy CONNECT failed: ${status}`));
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      const remainder = response.subarray(end + 4);
      if (remainder.length) upstream.unshift(remainder);
      resolve(upstream);
    });
  });
}

const clients = new Set();
const server = net.createServer((client) => {
  clients.add(client);
  client.once('close', () => clients.delete(client));
  connectThroughProxy().then((upstream) => {
    client.setTimeout(0);
    upstream.setTimeout(0);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
    client.pipe(upstream);
    upstream.pipe(client);
  }).catch((error) => {
    console.error(`neon tunnel connection failed: ${error.message}`);
    client.destroy();
  });
});

server.on('error', (error) => {
  console.error(`neon tunnel server error: ${error.message}`);
  process.exitCode = 1;
});
server.listen(listenPort, listenHost, () => {
  console.log(`neon tunnel listening on ${listenHost}:${listenPort} -> ${targetHost}:${targetPort} via ${proxyHost}:${proxyPort}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  for (const client of clients) client.destroy();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
