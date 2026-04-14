"""FastAPI server for the Support AI Agent."""

import asyncio
from datetime import datetime
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from supabase import create_client, Client
from config import get_settings
from agent import get_agent, AgentResponse


# Supabase client (lazy init)
_supabase_client: Client | None = None


def get_supabase() -> Client:
    """Get Supabase client instance."""
    global _supabase_client
    if _supabase_client is None:
        settings = get_settings()
        _supabase_client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key
        )
    return _supabase_client


# Request/Response models
class TicketRequest(BaseModel):
    """Incoming ticket request."""
    ticket_id: str = Field(..., description="Unique ticket identifier")
    question: str = Field(..., description="Customer question text")
    subject: Optional[str] = Field(None, description="Ticket subject")
    client_name: Optional[str] = Field(None, description="Customer name")
    channel: Optional[str] = Field(None, description="Channel: email, chat, api")


class AgentResponseModel(BaseModel):
    """Agent response model."""
    ticket_id: str
    draft_response: str
    categories: list[str]
    needs_escalation: bool
    escalation_reason: Optional[str]
    confidence: float
    retrieved_docs_count: int
    generated_at: str


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    timestamp: str
    version: str = "1.0.0"


class TicketSummary(BaseModel):
    """Ticket summary for inbox."""
    ticket_id: int
    case_number: Optional[str]
    subject: Optional[str]
    first_message_preview: str
    client_name: Optional[str]
    status: Optional[str]
    priority: Optional[str]
    channel: Optional[str]
    created_at: str


# Lifespan for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # Startup: initialize agent
    print("Starting Support AI Agent...")
    settings = get_settings()
    print(f"LLM Provider: {settings.llm_provider}")
    print(f"LLM Model: {settings.llm_model}")

    # Pre-initialize agent
    get_agent()
    print("Agent initialized successfully")

    yield

    # Shutdown
    print("Shutting down Support AI Agent...")


# Create FastAPI app
app = FastAPI(
    title="MetaShip Support AI Agent",
    description="AI-powered support agent with RAG and tools",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files directory
STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def root():
    """Serve the web UI."""
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": "MetaShip Support AI Agent API", "docs": "/docs"}


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        timestamp=datetime.utcnow().isoformat()
    )


@app.get("/tickets/recent", response_model=list[TicketSummary])
async def get_recent_tickets(
    limit: int = 5,
    status: Optional[str] = None
):
    """
    Get recent tickets from Supabase.

    Args:
        limit: Number of tickets to return (default 5, max 20)
        status: Filter by status (open, waiting, closed)
    """
    try:
        supabase = get_supabase()

        # Build query
        query = supabase.table("support_tickets").select(
            "ticket_id, case_number, subject, first_message_text, "
            "company_name, user_name, status, priority, channel, created_at"
        ).order("created_at", desc=True).limit(min(limit, 20))

        # Optional status filter
        if status:
            query = query.eq("status", status)

        result = query.execute()

        # Transform to response model
        tickets = []
        for row in result.data:
            # Get client name (prefer company, then user name)
            client_name = row.get("company_name") or row.get("user_name")

            # Preview of first message (first 150 chars)
            first_msg = row.get("first_message_text") or ""
            preview = first_msg[:150] + "..." if len(first_msg) > 150 else first_msg

            tickets.append(TicketSummary(
                ticket_id=row["ticket_id"],
                case_number=row.get("case_number"),
                subject=row.get("subject"),
                first_message_preview=preview,
                client_name=client_name,
                status=row.get("status"),
                priority=row.get("priority"),
                channel=row.get("channel"),
                created_at=row["created_at"]
            ))

        return tickets

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error fetching tickets: {str(e)}"
        )


@app.post("/generate", response_model=AgentResponseModel)
async def generate_response(
    request: TicketRequest,
    background_tasks: BackgroundTasks
):
    """
    Generate a draft response for a support ticket.

    This endpoint:
    1. Classifies the question
    2. Retrieves relevant FAQ context
    3. Generates a draft response using LangChain agent
    4. Returns the draft for operator review
    """
    try:
        agent = get_agent()

        # Combine subject and question
        full_question = request.question
        if request.subject:
            full_question = f"{request.subject}\n\n{request.question}"

        # Generate response
        result: AgentResponse = await agent.generate_response(
            question=full_question,
            client_name=request.client_name,
            ticket_id=request.ticket_id
        )

        # Optionally send to Telegram in background
        settings = get_settings()
        if settings.telegram_bot_token and settings.telegram_chat_id:
            background_tasks.add_task(
                send_telegram_notification,
                request.ticket_id,
                request.client_name,
                result
            )

        return AgentResponseModel(
            ticket_id=request.ticket_id,
            draft_response=result.draft_response,
            categories=result.categories,
            needs_escalation=result.needs_escalation,
            escalation_reason=result.escalation_reason,
            confidence=result.confidence,
            retrieved_docs_count=len(result.retrieved_context),
            generated_at=datetime.utcnow().isoformat()
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error generating response: {str(e)}"
        )


@app.post("/classify")
async def classify_question(request: TicketRequest):
    """
    Classify a question without generating a full response.

    Useful for routing or quick triage.
    """
    try:
        agent = get_agent()
        classification = await agent.classify_question(request.question)

        return {
            "ticket_id": request.ticket_id,
            "classification": classification,
            "timestamp": datetime.utcnow().isoformat()
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error classifying question: {str(e)}"
        )


@app.post("/search")
async def search_faq(query: str, k: int = 5):
    """
    Search the FAQ vector store directly.

    Useful for debugging or manual searches.
    """
    try:
        agent = get_agent()
        results = await agent.retrieve_context(query)

        return {
            "query": query,
            "results": results[:k],
            "total_found": len(results),
            "timestamp": datetime.utcnow().isoformat()
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error searching FAQ: {str(e)}"
        )


async def send_telegram_notification(
    ticket_id: str,
    client_name: Optional[str],
    result: AgentResponse
):
    """Send notification to Telegram (background task)."""
    settings = get_settings()

    escalation_icon = "⚠️ " if result.needs_escalation else ""
    categories = ", ".join(result.categories)

    message = (
        f"{escalation_icon}📩 *Новый тикет #{ticket_id}*\n\n"
        f"👤 Клиент: {client_name or 'Неизвестен'}\n"
        f"📂 Категории: {categories}\n"
        f"🎯 Уверенность: {result.confidence:.0%}\n"
        f"📚 Найдено в FAQ: {len(result.retrieved_context)} док.\n\n"
        f"✍️ *Черновик ответа:*\n{result.draft_response[:1500]}"
    )

    if result.needs_escalation:
        message += f"\n\n⚠️ _Эскалация: {result.escalation_reason}_"

    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
                json={
                    "chat_id": settings.telegram_chat_id,
                    "text": message,
                    "parse_mode": "Markdown"
                }
            )
    except Exception as e:
        print(f"Failed to send Telegram notification: {e}")


# Run with: uvicorn main:app --reload
if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
