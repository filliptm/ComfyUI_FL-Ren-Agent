"""Claude OAuth auth service ported from Cypher."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import secrets
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional
import urllib.request
import urllib.error
from urllib.parse import urlencode


PROJECT_ROOT = Path(__file__).parent.parent
TOKEN_DIR = PROJECT_ROOT / ".ren"
TOKEN_FILE = TOKEN_DIR / "auth.json"

OAUTH_CONFIG = {
    "clientId": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    "authUrl": "https://claude.ai/oauth/authorize",
    "tokenUrl": "https://console.anthropic.com/v1/oauth/token",
    "redirectUri": "https://console.anthropic.com/oauth/code/callback",
    "scope": "user:inference",
}

CHALLENGE_EXPIRY_SECONDS = 10 * 60
REFRESH_BUFFER_SECONDS = 5 * 60


def _base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _post_json(url: str, body: Dict[str, Any]) -> Dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Token request failed ({e.code}): {detail}") from e


@dataclass
class PkceChallenge:
    code_verifier: str
    code_challenge: str
    state: str
    created_at: float


class AuthService:
    def __init__(self) -> None:
        self.pending_challenge: Optional[PkceChallenge] = None
        self.token_data: Optional[Dict[str, Any]] = None
        self._refresh_timer: Optional[threading.Timer] = None
        self._load_tokens_from_disk()

    def start_oauth(self) -> Dict[str, str]:
        code_verifier = _base64url(secrets.token_bytes(32))
        code_challenge = _base64url(hashlib.sha256(code_verifier.encode("ascii")).digest())
        state = secrets.token_hex(32)

        self.pending_challenge = PkceChallenge(
            code_verifier=code_verifier,
            code_challenge=code_challenge,
            state=state,
            created_at=time.time(),
        )

        params = urlencode({
            "response_type": "code",
            "client_id": OAUTH_CONFIG["clientId"],
            "redirect_uri": OAUTH_CONFIG["redirectUri"],
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "scope": OAUTH_CONFIG["scope"],
            "state": state,
        })

        return {
            "authorizationUrl": f"{OAUTH_CONFIG['authUrl']}?{params}",
            "state": state,
        }

    async def exchange_code(self, code: str, callback_state: str, pkce_state: str) -> Dict[str, bool]:
        if not self.pending_challenge:
            raise RuntimeError("No pending OAuth challenge. Call startOAuth first.")
        if self.pending_challenge.state != pkce_state:
            raise RuntimeError("State parameter mismatch. Possible CSRF attack.")
        if time.time() - self.pending_challenge.created_at > CHALLENGE_EXPIRY_SECONDS:
            self.pending_challenge = None
            raise RuntimeError("OAuth challenge expired. Please start the flow again.")

        body = {
            "grant_type": "authorization_code",
            "code": code,
            "state": callback_state,
            "redirect_uri": OAUTH_CONFIG["redirectUri"],
            "client_id": OAUTH_CONFIG["clientId"],
            "code_verifier": self.pending_challenge.code_verifier,
        }

        data = await asyncio.to_thread(_post_json, OAUTH_CONFIG["tokenUrl"], body)
        self.token_data = {
            "accessToken": data["access_token"],
            "refreshToken": data["refresh_token"],
            "expiresAt": int(time.time()) + int(data["expires_in"]),
        }
        self._save_tokens_to_disk()
        self._schedule_refresh()
        self.pending_challenge = None
        return {"success": True}

    async def refresh_tokens(self) -> None:
        if not self.token_data or not self.token_data.get("refreshToken"):
            raise RuntimeError("No refresh token available")

        body = {
            "grant_type": "refresh_token",
            "refresh_token": self.token_data["refreshToken"],
            "client_id": OAUTH_CONFIG["clientId"],
        }
        try:
            data = await asyncio.to_thread(_post_json, OAUTH_CONFIG["tokenUrl"], body)
        except Exception as e:
            self.sign_out()
            raise RuntimeError("Token refresh failed. Please re-authenticate.") from e
        self.token_data = {
            "accessToken": data["access_token"],
            "refreshToken": data["refresh_token"],
            "expiresAt": int(time.time()) + int(data["expires_in"]),
        }
        self._save_tokens_to_disk()
        self._schedule_refresh()

    def get_access_token(self) -> Optional[str]:
        if not self.token_data:
            return None
        if int(time.time()) >= int(self.token_data.get("expiresAt", 0)):
            return None
        return str(self.token_data.get("accessToken") or "")

    async def get_valid_access_token(self) -> str:
        if not self.token_data:
            raise RuntimeError("Not authenticated")
        now = int(time.time())
        if now >= int(self.token_data.get("expiresAt", 0)) - REFRESH_BUFFER_SECONDS:
            await self.refresh_tokens()
        token = self.get_access_token()
        if not token:
            raise RuntimeError("Not authenticated")
        return token

    def get_status(self) -> Dict[str, Any]:
        if not self.token_data:
            return {"authenticated": False}
        expires_at = int(self.token_data.get("expiresAt", 0))
        if int(time.time()) >= expires_at:
            return {"authenticated": False}
        return {
            "authenticated": True,
            "method": "oauth",
            "expiresAt": expires_at,
        }

    def sign_out(self) -> None:
        self.token_data = None
        self.pending_challenge = None
        if self._refresh_timer:
            self._refresh_timer.cancel()
            self._refresh_timer = None
        try:
            TOKEN_FILE.unlink()
        except FileNotFoundError:
            pass

    def _load_tokens_from_disk(self) -> None:
        try:
            data = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
            if int(time.time()) < int(data.get("expiresAt", 0)):
                self.token_data = data
                self._schedule_refresh()
                print("[AuthService] Loaded tokens from disk")
            else:
                print("[AuthService] Stored tokens expired, ignoring")
        except Exception:
            pass

    def _save_tokens_to_disk(self) -> None:
        if not self.token_data:
            return
        TOKEN_DIR.mkdir(exist_ok=True)
        os.chmod(TOKEN_DIR, 0o700)
        TOKEN_FILE.write_text(json.dumps(self.token_data, indent=2), encoding="utf-8")
        os.chmod(TOKEN_FILE, 0o600)

    def _schedule_refresh(self) -> None:
        if self._refresh_timer:
            self._refresh_timer.cancel()
            self._refresh_timer = None
        if not self.token_data:
            return

        refresh_at = int(self.token_data.get("expiresAt", 0)) - REFRESH_BUFFER_SECONDS
        delay_seconds = max(0, refresh_at - int(time.time()))
        self._refresh_timer = threading.Timer(delay_seconds, self._refresh_in_background)
        self._refresh_timer.daemon = True
        self._refresh_timer.start()

    def _refresh_in_background(self) -> None:
        try:
            asyncio.run(self.refresh_tokens())
            print("[AuthService] Token refreshed automatically")
        except Exception as e:
            print(f"[AuthService] Auto-refresh failed: {e}")


auth_service = AuthService()
