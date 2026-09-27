"""Local snapshots and recoverable user-data transactions."""

from contextvars import ContextVar

ACTIVE = ContextVar("recovery_session", default=None)


def active():
    return ACTIVE.get()
