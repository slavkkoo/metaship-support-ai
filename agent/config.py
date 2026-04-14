"""Configuration for the Support AI Agent."""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # API Keys
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    # Supabase
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # Database (for pgvector direct connection)
    database_url: str = ""  # postgresql://user:pass@host:5432/postgres

    # Model settings
    llm_model: str = "gpt-4o-mini"  # or "claude-3-5-sonnet-20241022"
    llm_provider: str = "openai"  # or "anthropic"
    embedding_model: str = "text-embedding-3-small"
    temperature: float = 0.3
    max_tokens: int = 1000

    # RAG settings
    retrieval_k: int = 5  # Number of documents to retrieve
    similarity_threshold: float = 0.7

    # MetaShip API (for tools)
    metaship_api_url: str = "https://api.metaship.ru"
    metaship_api_token: str = ""

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # Telegram (optional, for notifications)
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
