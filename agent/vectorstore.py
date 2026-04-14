"""Vector store operations using Supabase pgvector."""

import json
from typing import List, Optional
from dataclasses import dataclass

from langchain_openai import OpenAIEmbeddings
from langchain_core.documents import Document
from supabase import create_client, Client

from config import get_settings


@dataclass
class SearchResult:
    """Search result from vector store."""
    content: str
    metadata: dict
    similarity: float


class FAQVectorStore:
    """Vector store for FAQ documents using Supabase pgvector."""

    def __init__(self):
        settings = get_settings()
        self.supabase: Client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key
        )
        self.embeddings = OpenAIEmbeddings(
            model=settings.embedding_model,
            openai_api_key=settings.openai_api_key
        )
        self.table_name = "faq_embeddings"
        self.k = settings.retrieval_k
        self.threshold = settings.similarity_threshold

    async def similarity_search(
        self,
        query: str,
        k: Optional[int] = None,
        threshold: Optional[float] = None
    ) -> List[SearchResult]:
        """
        Search for similar documents using cosine similarity.

        Args:
            query: Search query
            k: Number of results to return
            threshold: Minimum similarity threshold

        Returns:
            List of SearchResult objects
        """
        k = k or self.k
        threshold = threshold or self.threshold

        # Generate embedding for query
        query_embedding = self.embeddings.embed_query(query)

        # Call Supabase RPC function for similarity search
        response = self.supabase.rpc(
            "match_faq_documents",
            {
                "query_embedding": query_embedding,
                "match_threshold": threshold,
                "match_count": k
            }
        ).execute()

        results = []
        for row in response.data or []:
            results.append(SearchResult(
                content=row["content"],
                metadata=row.get("metadata", {}),
                similarity=row["similarity"]
            ))

        return results

    async def add_documents(self, documents: List[Document]) -> int:
        """
        Add documents to the vector store.

        Args:
            documents: List of LangChain Document objects

        Returns:
            Number of documents added
        """
        if not documents:
            return 0

        # Generate embeddings
        texts = [doc.page_content for doc in documents]
        embeddings = self.embeddings.embed_documents(texts)

        # Prepare rows for insertion
        rows = []
        for doc, embedding in zip(documents, embeddings):
            rows.append({
                "content": doc.page_content,
                "metadata": doc.metadata,
                "embedding": embedding
            })

        # Insert into Supabase
        response = self.supabase.table(self.table_name).upsert(
            rows,
            on_conflict="content"  # Deduplicate by content
        ).execute()

        return len(response.data) if response.data else 0

    async def delete_all(self) -> bool:
        """Delete all documents from the vector store."""
        self.supabase.table(self.table_name).delete().neq("id", 0).execute()
        return True


def get_vectorstore() -> FAQVectorStore:
    """Get vector store instance."""
    return FAQVectorStore()


# SQL to create the table and function in Supabase
SETUP_SQL = """
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create FAQ embeddings table
CREATE TABLE IF NOT EXISTS faq_embeddings (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    embedding vector(1536),  -- OpenAI text-embedding-3-small dimension
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_content UNIQUE (content)
);

-- Create index for fast similarity search
CREATE INDEX IF NOT EXISTS faq_embeddings_embedding_idx
ON faq_embeddings
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create similarity search function
CREATE OR REPLACE FUNCTION match_faq_documents(
    query_embedding vector(1536),
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 5
)
RETURNS TABLE (
    id BIGINT,
    content TEXT,
    metadata JSONB,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        faq_embeddings.id,
        faq_embeddings.content,
        faq_embeddings.metadata,
        1 - (faq_embeddings.embedding <=> query_embedding) AS similarity
    FROM faq_embeddings
    WHERE 1 - (faq_embeddings.embedding <=> query_embedding) > match_threshold
    ORDER BY faq_embeddings.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
"""
