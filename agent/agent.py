"""LangChain Support Agent with RAG and Tools."""

import json
from typing import Optional
from dataclasses import dataclass

from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langgraph.prebuilt import create_react_agent

from config import get_settings
from prompts import SYSTEM_PROMPT, CLASSIFICATION_PROMPT, RAG_PROMPT_TEMPLATE
from tools import ALL_TOOLS, search_faq
from vectorstore import get_vectorstore


@dataclass
class AgentResponse:
    """Response from the support agent."""
    draft_response: str
    categories: list[str]
    needs_escalation: bool
    escalation_reason: Optional[str]
    confidence: float
    retrieved_context: list[dict]
    raw_llm_response: Optional[str] = None


class SupportAgent:
    """LangChain-based support agent with RAG and tools."""

    def __init__(self):
        self.settings = get_settings()
        self.llm = self._create_llm()
        self.classifier_llm = self._create_llm(temperature=0.1)
        self.vectorstore = get_vectorstore()
        self.agent_executor = self._create_agent()

    def _create_llm(self, temperature: Optional[float] = None):
        """Create LLM instance based on settings."""
        temp = temperature if temperature is not None else self.settings.temperature

        if self.settings.llm_provider == "anthropic":
            return ChatAnthropic(
                model=self.settings.llm_model,
                anthropic_api_key=self.settings.anthropic_api_key,
                temperature=temp,
                max_tokens=self.settings.max_tokens
            )
        else:
            return ChatOpenAI(
                model=self.settings.llm_model,
                openai_api_key=self.settings.openai_api_key,
                temperature=temp,
                max_tokens=self.settings.max_tokens
            )

    def _create_agent(self):
        """Create the react agent with tools."""
        return create_react_agent(
            self.llm,
            tools=ALL_TOOLS,
            prompt=SYSTEM_PROMPT
        )

    async def classify_question(self, question: str) -> dict:
        """
        Classify the customer question into categories.

        Args:
            question: Customer question text

        Returns:
            Classification result with categories and escalation flag
        """
        messages = [
            SystemMessage(content=CLASSIFICATION_PROMPT),
            HumanMessage(content=f"Вопрос клиента:\n{question}")
        ]

        response = await self.classifier_llm.ainvoke(messages)

        try:
            # Parse JSON from response
            content = response.content
            # Remove markdown code blocks if present
            if "```" in content:
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]

            return json.loads(content.strip())
        except json.JSONDecodeError:
            return {
                "primary_category": "Общий вопрос",
                "secondary_categories": [],
                "needs_escalation": False,
                "escalation_reason": None,
                "confidence": 0.5
            }

    async def retrieve_context(self, question: str) -> list[dict]:
        """
        Retrieve relevant context from FAQ vector store.

        Args:
            question: Customer question

        Returns:
            List of relevant documents with metadata
        """
        results = await self.vectorstore.similarity_search(question)

        return [
            {
                "content": r.content,
                "category": r.metadata.get("category", ""),
                "ticket_id": r.metadata.get("ticket_id", ""),
                "similarity": r.similarity
            }
            for r in results
        ]

    async def generate_response(
        self,
        question: str,
        client_name: Optional[str] = None,
        ticket_id: Optional[str] = None,
        chat_history: Optional[list] = None
    ) -> AgentResponse:
        """
        Generate a draft response to the customer question.

        Args:
            question: Customer question text
            client_name: Name of the customer (optional)
            ticket_id: Support ticket ID (optional)
            chat_history: Previous messages in conversation (optional)

        Returns:
            AgentResponse with draft and metadata
        """
        # Step 1: Classify the question
        classification = await self.classify_question(question)

        # Step 2: Retrieve relevant context
        context = await self.retrieve_context(question)

        # Step 3: Prepare input with context
        context_text = "\n\n".join([
            f"[{c['category']}] (релевантность: {c['similarity']:.0%})\n{c['content']}"
            for c in context
        ]) if context else "Релевантный контекст не найден."

        enhanced_input = (
            f"КЛИЕНТ: {client_name or 'Неизвестен'}\n"
            f"ТИКЕТ: #{ticket_id or 'N/A'}\n\n"
            f"КЛАССИФИКАЦИЯ: {classification['primary_category']}\n"
            f"ТРЕБУЕТ ЭСКАЛАЦИИ: {'Да' if classification['needs_escalation'] else 'Нет'}\n\n"
            f"КОНТЕКСТ ИЗ FAQ:\n{context_text}\n\n"
            f"ВОПРОС КЛИЕНТА:\n{question}"
        )

        # Step 4: Run the agent
        try:
            messages = chat_history or []
            messages.append(HumanMessage(content=enhanced_input))

            result = await self.agent_executor.ainvoke({"messages": messages})

            # Extract response from the last AI message
            ai_messages = [m for m in result.get("messages", []) if isinstance(m, AIMessage)]
            draft_response = ai_messages[-1].content if ai_messages else "Не удалось сгенерировать ответ."

        except Exception as e:
            draft_response = f"Ошибка при генерации ответа: {str(e)}\n\nТребуется помощь оператора."
            classification["needs_escalation"] = True
            classification["escalation_reason"] = f"Ошибка агента: {str(e)}"

        # Step 5: Compile response
        categories = [classification["primary_category"]]
        if classification.get("secondary_categories"):
            categories.extend(classification["secondary_categories"])

        return AgentResponse(
            draft_response=draft_response,
            categories=categories,
            needs_escalation=classification.get("needs_escalation", False),
            escalation_reason=classification.get("escalation_reason"),
            confidence=classification.get("confidence", 0.5),
            retrieved_context=context
        )


# Singleton instance
_agent_instance: Optional[SupportAgent] = None


def get_agent() -> SupportAgent:
    """Get or create agent instance."""
    global _agent_instance
    if _agent_instance is None:
        _agent_instance = SupportAgent()
    return _agent_instance
