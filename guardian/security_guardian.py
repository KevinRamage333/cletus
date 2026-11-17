"""Cletus Guardian: defensive, read-only security event evaluator.

No scanning of third-party hosts, no shell execution, no access to wallet keys.
All enforcement remains in independently controlled services.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Mapping
import hashlib
import hmac
import json

SUSPICIOUS_EVENTS = {
    "auth.failed": ("medium", "Investigate repeated authentication failures"),
    "auth.admin_failed": ("high", "Review privileged access attempts"),
    "wallet.signing_anomaly": ("critical", "Suspend automated signing via independent policy engine"),
    "trade.risk_limit_exceeded": ("critical", "Disable live execution via independent trading controls"),
    "infra.secret_exposure": ("critical", "Revoke and rotate exposed credential"),
    "infra.deployment_failed": ("medium", "Inspect deployment and roll back if authorized"),
    "api.rate_limit_exceeded": ("medium", "Inspect abusive request patterns"),
}

@dataclass(frozen=True)
class Finding:
    event_type: str
    severity: str
    recommendation: str
    fingerprint: str
    observed_at: str

def evaluate_event(event: Mapping[str, object]) -> Finding | None:
    """Evaluate allowlisted event types without storing sensitive payloads."""
    event_type = event.get("type")
    if not isinstance(event_type, str) or event_type not in SUSPICIOUS_EVENTS:
        return None
    severity, recommendation = SUSPICIOUS_EVENTS[event_type]
    # Fingerprint deliberately excludes potentially secret-bearing event fields.
    identifier = str(event.get("event_id", ""))[:128]
    fingerprint = hashlib.sha256(f"{event_type}:{identifier}".encode()).hexdigest()[:24]
    return Finding(event_type, severity, recommendation, fingerprint,
                   datetime.now(timezone.utc).isoformat())

def verify_webhook(body: bytes, signature: str, secret: str) -> bool:
    """Validate HMAC-SHA256 signature before parsing a webhook payload."""
    if not secret or not signature.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature[7:], expected)

def safe_json(finding: Finding) -> str:
    return json.dumps(finding.__dict__, sort_keys=True)
