#!/usr/bin/env python3
"""
Script to index FAQ data into Supabase pgvector.

Usage:
    python index_faq.py                    # Index from default faq-data.json
    python index_faq.py --file path.json   # Index from custom file
    python index_faq.py --clear            # Clear existing data first
    python index_faq.py --setup            # Run SQL setup (create table & function)
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

from langchain_core.documents import Document
from supabase import create_client

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from config import get_settings
from vectorstore import FAQVectorStore, SETUP_SQL


async def load_faq_data(file_path: str) -> list[Document]:
    """
    Load FAQ data from JSON file and convert to Documents.

    Expected format:
    {
        "Category Name": [
            {
                "ticket_id": 123456,
                "question": "...",
                "answer": "...",
                ...
            }
        ]
    }
    """
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    documents = []

    for category, items in data.items():
        for item in items:
            # Create document content combining Q&A
            question = item.get("question", "")
            answer = item.get("answer", "")
            subject = item.get("subject", "")

            content = f"Вопрос: {question}\n\nОтвет: {answer}"

            if subject and subject != question:
                content = f"Тема: {subject}\n\n{content}"

            # Metadata for filtering and display
            metadata = {
                "category": category,
                "ticket_id": str(item.get("ticket_id", "")),
                "source": "faq",
                "has_answer": bool(answer)
            }

            documents.append(Document(
                page_content=content,
                metadata=metadata
            ))

    return documents


async def setup_database():
    """Run SQL setup to create table and function."""
    settings = get_settings()
    supabase = create_client(
        settings.supabase_url,
        settings.supabase_service_role_key
    )

    print("Running database setup...")
    print("Note: You may need to run this SQL manually in Supabase SQL Editor:")
    print("-" * 50)
    print(SETUP_SQL)
    print("-" * 50)

    # Try to execute via RPC (may not work for DDL)
    try:
        # This likely won't work for CREATE TABLE, but worth trying
        supabase.rpc("exec_sql", {"sql": SETUP_SQL}).execute()
        print("Setup SQL executed successfully")
    except Exception as e:
        print(f"Could not execute SQL via RPC: {e}")
        print("Please run the SQL manually in Supabase SQL Editor")


async def index_documents(
    file_path: str,
    clear_existing: bool = False
):
    """Index FAQ documents into vector store."""
    print(f"Loading FAQ data from: {file_path}")

    # Load documents
    documents = await load_faq_data(file_path)
    print(f"Loaded {len(documents)} documents")

    # Deduplicate by content
    seen_content = set()
    unique_documents = []
    for doc in documents:
        if doc.page_content not in seen_content:
            seen_content.add(doc.page_content)
            unique_documents.append(doc)

    if len(unique_documents) < len(documents):
        print(f"Removed {len(documents) - len(unique_documents)} duplicates")
    documents = unique_documents

    # Group by category for stats
    categories = {}
    for doc in documents:
        cat = doc.metadata.get("category", "Unknown")
        categories[cat] = categories.get(cat, 0) + 1

    print("\nDocuments by category:")
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")

    # Initialize vector store
    vectorstore = FAQVectorStore()

    # Clear existing if requested
    if clear_existing:
        print("\nClearing existing documents...")
        await vectorstore.delete_all()

    # Index documents in batches
    batch_size = 50
    total_indexed = 0

    print(f"\nIndexing {len(documents)} documents...")

    for i in range(0, len(documents), batch_size):
        batch = documents[i:i + batch_size]
        count = await vectorstore.add_documents(batch)
        total_indexed += count
        print(f"  Indexed batch {i // batch_size + 1}: {count} documents")

    print(f"\nTotal indexed: {total_indexed} documents")
    return total_indexed


async def test_search(query: str):
    """Test search functionality."""
    print(f"\nTesting search: '{query}'")

    vectorstore = FAQVectorStore()
    results = await vectorstore.similarity_search(query, k=3)

    if not results:
        print("No results found")
        return

    print(f"Found {len(results)} results:\n")

    for i, result in enumerate(results, 1):
        print(f"[{i}] Similarity: {result.similarity:.2%}")
        print(f"    Category: {result.metadata.get('category', 'N/A')}")
        print(f"    Content: {result.content[:200]}...")
        print()


async def main():
    parser = argparse.ArgumentParser(description="Index FAQ into vector store")
    parser.add_argument(
        "--file",
        default="../faq-data.json",
        help="Path to FAQ JSON file"
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Clear existing data before indexing"
    )
    parser.add_argument(
        "--setup",
        action="store_true",
        help="Run database setup (create table & function)"
    )
    parser.add_argument(
        "--test",
        type=str,
        help="Test search with a query"
    )

    args = parser.parse_args()

    # Resolve file path relative to script
    script_dir = Path(__file__).parent
    file_path = script_dir / args.file

    if args.setup:
        await setup_database()
        return

    if args.test:
        await test_search(args.test)
        return

    if not file_path.exists():
        print(f"Error: File not found: {file_path}")
        print("\nMake sure faq-data.json exists in the project root")
        sys.exit(1)

    await index_documents(str(file_path), clear_existing=args.clear)

    # Run a test search
    await test_search("как создать заказ через API")


if __name__ == "__main__":
    asyncio.run(main())
