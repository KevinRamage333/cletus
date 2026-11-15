#!/usr/bin/env python3
"""TCP tunnel: 127.0.0.1:15432 -> Neon:5432 through the box HTTP CONNECT proxy.
This box's DNS maps Neon hosts to an intercept IP, so Prisma/psql must use the tunnel.
No credentials are logged or required here.
"""
import os, select, socket, sys, threading

LISTEN = (os.environ.get("NEON_TUNNEL_LISTEN", "127.0.0.1"), int(os.environ.get("NEON_TUNNEL_PORT", "15432")))
PROXY = (os.environ.get("NEON_TUNNEL_PROXY", "127.0.0.1"), int(os.environ.get("NEON_TUNNEL_PROXY_PORT", "8791")))
TARGET_HOST = os.environ.get("NEON_TUNNEL_HOST", "ep-mute-mode-bdjsbdzj.c-8.us-east-2.aws.neon.tech")
TARGET_PORT = int(os.environ.get("NEON_TUNNEL_TARGET_PORT", "5432"))

def log(msg: str) -> None:
    print(msg, flush=True)

def connect_target() -> socket.socket:
    s = socket.create_connection(PROXY, timeout=15)
    req = f"CONNECT {TARGET_HOST}:{TARGET_PORT} HTTP/1.1\r\nHost: {TARGET_HOST}:{TARGET_PORT}\r\n\r\n"
    s.sendall(req.encode())
    s.settimeout(15)
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = s.recv(4096)
        if not chunk:
            raise OSError("proxy closed during CONNECT")
        buf += chunk
    status = buf.split(b"\r\n", 1)[0].decode("latin1", "replace")
    if b" 200 " not in buf.split(b"\r\n", 1)[0] and not status.startswith("HTTP/1.1 200"):
        raise OSError(f"proxy CONNECT failed: {status}")
    s.settimeout(None)
    return s

def pipe(a: socket.socket, b: socket.socket) -> None:
    try:
        while True:
            r, _, _ = select.select([a, b], [], [], 300)
            if not r:
                continue
            for src in r:
                dst = b if src is a else a
                data = src.recv(65536)
                if not data:
                    return
                dst.sendall(data)
    except OSError:
        return
    finally:
        try: a.shutdown(socket.SHUT_RDWR)
        except OSError: pass
        try: b.shutdown(socket.SHUT_RDWR)
        except OSError: pass
        a.close(); b.close()

def handle(client: socket.socket, addr) -> None:
    try:
        upstream = connect_target()
    except Exception as e:
        log(f"tunnel connect failed from {addr[0]}: {e}")
        client.close()
        return
    pipe(client, upstream)

def main() -> int:
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(LISTEN)
    srv.listen(128)
    log(f"neon tunnel listening on {LISTEN[0]}:{LISTEN[1]} -> {TARGET_HOST}:{TARGET_PORT} via {PROXY[0]}:{PROXY[1]}")
    while True:
        c, addr = srv.accept()
        t = threading.Thread(target=handle, args=(c, addr), daemon=True)
        t.start()

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
