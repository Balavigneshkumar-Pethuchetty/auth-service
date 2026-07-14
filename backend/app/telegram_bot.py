"""
Telegram bot OTP delivery — an alternate channel to the SMS gateway chain
(sms_gateway.py) that sidesteps Indian carriers' OTP-pattern content
filtering on personal SIMs (see that module's docstring and CLAUDE.md).

Bots can't message a user until that user starts a chat with the bot, so
delivery requires a one-time "link" step: the frontend sends the user to
deep_link(phone) (https://t.me/<bot>?start=<phone digits>), the user taps
Start, Telegram POSTs that /start command to our webhook, and
handle_update() captures the resulting chat_id into TelegramLink. Once
linked, send_otp() can message that phone directly by chat_id.
"""
import logging

import httpx
from sqlalchemy.orm import Session

from . import models
from .config import settings
from .splunk_logger import log_app_error

log = logging.getLogger(__name__)

_TIMEOUT = 10.0


def _mask_phone(phone: str) -> str:
    return "*" * max(0, len(phone) - 4) + phone[-4:] if len(phone) >= 4 else "***"


def _api_url(method: str) -> str:
    return f"https://api.telegram.org/bot{settings.telegram_bot_token}/{method}"


def _normalize_phone(phone: str) -> str:
    return "".join(c for c in phone if c.isdigit())


async def send_message(chat_id: str, text: str) -> tuple[bool, str | None]:
    if not settings.telegram_bot_token:
        return False, "TELEGRAM_BOT_TOKEN not configured"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(_api_url("sendMessage"), json={"chat_id": chat_id, "text": text})
        if r.status_code < 300 and r.json().get("ok"):
            return True, None
        error = f"HTTP {r.status_code}: {r.text[:200]}"
        await log_app_error({"event": "telegram_send_failed", "chat_id": chat_id, "error": error})
        return False, error
    except Exception as exc:
        await log_app_error({"event": "telegram_send_exception", "chat_id": chat_id, "error": str(exc)[:200]})
        return False, str(exc)


def deep_link(phone: str) -> str | None:
    if not settings.telegram_bot_username:
        return None
    return f"https://t.me/{settings.telegram_bot_username}?start={_normalize_phone(phone)}"


def link_status(db: Session, phone: str) -> dict:
    link = db.get(models.TelegramLink, _normalize_phone(phone))
    return {"linked": link is not None, "deep_link": deep_link(phone)}


async def handle_update(db: Session, update: dict) -> None:
    """Process an incoming Telegram webhook update. Only /start deep links
    are handled — anything else (arbitrary user messages) is ignored."""
    message = update.get("message") or {}
    text = message.get("text", "")
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if not chat_id or not text.startswith("/start"):
        return

    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        await send_message(str(chat_id), "Open this link from the login page to connect your phone number.")
        return

    phone = _normalize_phone(parts[1])
    if not phone:
        return

    link = db.get(models.TelegramLink, phone)
    if link:
        link.chat_id = str(chat_id)
    else:
        db.add(models.TelegramLink(phone=phone, chat_id=str(chat_id)))
    db.commit()

    await send_message(str(chat_id), "Telegram connected — verification codes for this number will be sent here.")


async def send_otp(db: Session, phone: str, text: str) -> dict:
    """Mirrors sms_gateway.send_otp's return shape so otp_service can treat
    this as just another channel in the delivery chain."""
    link = db.get(models.TelegramLink, _normalize_phone(phone))
    if not link:
        await log_app_error({"event": "telegram_not_linked", "phone": _mask_phone(phone)})
        return {"sent": False, "via": None, "attempts": [], "error": "phone not linked to Telegram"}
    ok, error = await send_message(link.chat_id, text)
    return {
        "sent": ok,
        "via": "telegram" if ok else None,
        "attempts": [{"gateway": "telegram", "ok": ok, "error": error}],
    }
