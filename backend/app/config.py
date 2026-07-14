from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg2://postgres:postgres@db:5432/standalone"
    domain: str = "gm-global-techies-town.club"

    # Keycloak
    keycloak_url: str = "http://keycloak:8080"
    keycloak_public_url: str = ""  # browser-facing URL, e.g. http://localhost:8180
    keycloak_realm: str = "standalone"
    keycloak_client_id: str = "sss-frontend"
    keycloak_admin_user: str = "admin"
    keycloak_admin_password: str = "admin"

    # Cloudflare (all empty = Cloudflare integration disabled)
    cloudflare_api_token: str = ""
    cloudflare_zone_id: str = ""
    cloudflare_account_id: str = ""
    cloudflare_tunnel_id: str = ""

    # OTP (SMS gateway delivery + verification lifecycle)
    otp_length: int = 6
    otp_ttl_seconds: int = 300
    otp_resend_cooldown_seconds: int = 60
    otp_max_attempts: int = 5
    otp_max_resends: int = 3
    otp_pepper: str = ""  # used when hashing codes for storage
    otp_service_api_key: str = ""  # shared secret for the Keycloak authenticator SPI

    # Telegram bot (alternate OTP delivery channel, avoids SMS carrier filtering)
    telegram_bot_token: str = ""  # from @BotFather
    telegram_bot_username: str = ""  # bot's @handle, no leading @
    telegram_webhook_secret: str = ""  # checked against X-Telegram-Bot-Api-Secret-Token

    # Splunk (shared instance in ~/splunk-service, HEC on :8088) — optional,
    # fire-and-forget; splunk_logger.py no-ops if the token is unset.
    splunk_hec_url: str = ""
    splunk_hec_token: str = ""

    class Config:
        env_file = ".env"
        env_prefix = ""


settings = Settings()
