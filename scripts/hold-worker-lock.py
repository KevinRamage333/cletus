#!/usr/bin/env python3
"""Hold an exclusive flock on LOCKPATH until stdin closes.

Usage: hold-worker-lock.py LOCKPATH PID STATUSPATH
Writes OK or BUSY to STATUSPATH (so the parent can wait without an event loop),
then blocks on stdin.
"""
import fcntl
import os
import sys

if len(sys.argv) < 4:
    sys.stderr.write("usage: hold-worker-lock.py LOCKPATH PID STATUSPATH\n")
    sys.exit(1)

path, pid, status_path = sys.argv[1], sys.argv[2], sys.argv[3]


def report(msg: str) -> None:
    tmp = status_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(msg + "\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, status_path)


fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    report("BUSY")
    sys.exit(2)

os.lseek(fd, 0, os.SEEK_SET)
os.ftruncate(fd, 0)
os.write(fd, (pid + "\n").encode())
os.fsync(fd)
report("OK")
try:
    sys.stdin.read()
except Exception:
    pass
