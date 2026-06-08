from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    manufacturing_internal_api_key: str = "dev-manufacturing-key"
    port: int = 8000
    cors_origins: str = "*"


settings = Settings()
