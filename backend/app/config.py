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

    class Config:
        env_file = ".env"
        env_prefix = ""


settings = Settings()
