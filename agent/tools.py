"""Tools for the Support AI Agent."""

import httpx
from typing import Optional
from langchain_core.tools import tool

from config import get_settings
from vectorstore import get_vectorstore


@tool
async def search_faq(query: str) -> str:
    """
    Поиск по базе знаний FAQ MetaShip.

    Используй этот инструмент для поиска ответов на типичные вопросы
    о создании заказов, статусах, ошибках, службах доставки и т.д.

    Args:
        query: Поисковый запрос на русском языке

    Returns:
        Релевантные фрагменты из FAQ с контекстом
    """
    vectorstore = get_vectorstore()
    results = await vectorstore.similarity_search(query, k=5)

    if not results:
        return "По запросу ничего не найдено в базе знаний."

    output = []
    for i, result in enumerate(results, 1):
        category = result.metadata.get("category", "Общее")
        ticket_id = result.metadata.get("ticket_id", "")
        ticket_info = f" (тикет #{ticket_id})" if ticket_id else ""

        output.append(
            f"[{i}] Категория: {category}{ticket_info}\n"
            f"Релевантность: {result.similarity:.0%}\n"
            f"{result.content}\n"
        )

    return "\n---\n".join(output)


@tool
async def check_order_status(order_guid: str) -> str:
    """
    Проверка статуса заказа в MetaShip по GUID.

    Используй этот инструмент когда клиент предоставил GUID заказа
    и хочет узнать его текущий статус.

    Args:
        order_guid: GUID заказа в формате UUID (например: acabdae7-6b86-4ba1-aef0-80334c7edaf4)

    Returns:
        Информация о статусе заказа или сообщение об ошибке
    """
    settings = get_settings()

    if not settings.metaship_api_token:
        return "API токен MetaShip не настроен. Передай вопрос оператору."

    # Validate GUID format
    import re
    guid_pattern = r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    if not re.match(guid_pattern, order_guid.lower()):
        return f"Некорректный формат GUID: {order_guid}. Ожидается формат UUID."

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{settings.metaship_api_url}/v2/orders/{order_guid}/details",
                headers={
                    "Authorization": f"Bearer {settings.metaship_api_token}",
                    "Content-Type": "application/json"
                }
            )

            if response.status_code == 404:
                return f"Заказ {order_guid} не найден."

            if response.status_code == 401:
                return "Ошибка авторизации API. Передай вопрос оператору."

            if response.status_code != 200:
                return f"Ошибка API: {response.status_code}. Передай вопрос оператору."

            data = response.json()

            # Extract key information
            status = data.get("status", "неизвестен")
            delivery_service = data.get("deliveryService", "неизвестна")
            tracking_number = data.get("trackingNumber", "нет")
            created_at = data.get("createdAt", "")
            updated_at = data.get("updatedAt", "")

            return (
                f"Заказ: {order_guid}\n"
                f"Статус: {status}\n"
                f"Служба доставки: {delivery_service}\n"
                f"Трек-номер: {tracking_number}\n"
                f"Создан: {created_at}\n"
                f"Обновлён: {updated_at}"
            )

    except httpx.TimeoutException:
        return "Таймаут при запросе к API MetaShip. Попробуй позже или передай оператору."
    except Exception as e:
        return f"Ошибка при проверке статуса: {str(e)}"


@tool
async def get_delivery_points(
    city: str,
    delivery_service: Optional[str] = None
) -> str:
    """
    Поиск пунктов выдачи (ПВЗ) по городу.

    Используй этот инструмент когда клиент ищет ПВЗ в определённом городе
    или спрашивает о доступности доставки.

    Args:
        city: Название города (например: "Москва", "Санкт-Петербург")
        delivery_service: Служба доставки (опционально): sdek, dalli, 5post, boxberry

    Returns:
        Список доступных ПВЗ или сообщение об ошибке
    """
    settings = get_settings()

    if not settings.metaship_api_token:
        return "API токен MetaShip не настроен. Передай вопрос оператору."

    try:
        params = {"city": city, "limit": 10}
        if delivery_service:
            params["deliveryService"] = delivery_service.lower()

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{settings.metaship_api_url}/v2/delivery-points",
                params=params,
                headers={
                    "Authorization": f"Bearer {settings.metaship_api_token}",
                    "Content-Type": "application/json"
                }
            )

            if response.status_code != 200:
                return f"Ошибка API: {response.status_code}. Передай вопрос оператору."

            data = response.json()
            points = data.get("items", [])

            if not points:
                ds_info = f" для {delivery_service}" if delivery_service else ""
                return f"ПВЗ в городе {city}{ds_info} не найдены."

            output = [f"Найдено ПВЗ в городе {city}: {len(points)} (показаны первые 10)\n"]

            for point in points[:10]:
                output.append(
                    f"- {point.get('name', 'Без названия')}\n"
                    f"  Адрес: {point.get('address', 'нет адреса')}\n"
                    f"  СД: {point.get('deliveryService', '?')}\n"
                    f"  Код: {point.get('code', '?')}"
                )

            return "\n".join(output)

    except httpx.TimeoutException:
        return "Таймаут при запросе ПВЗ. Попробуй позже или передай оператору."
    except Exception as e:
        return f"Ошибка при поиске ПВЗ: {str(e)}"


@tool
def escalate_to_operator(reason: str) -> str:
    """
    Отметить вопрос для эскалации на оператора.

    Используй этот инструмент когда вопрос:
    - Требует доступа к внутренним системам
    - Связан с финансами, возвратами средств
    - Является жалобой
    - Не относится к MetaShip
    - Слишком сложный для автоматического ответа

    Args:
        reason: Причина эскалации

    Returns:
        Подтверждение эскалации
    """
    return f"ЭСКАЛАЦИЯ: {reason}\n\nЭтот вопрос будет передан оператору для ручной обработки."


# List of all available tools
ALL_TOOLS = [
    search_faq,
    check_order_status,
    get_delivery_points,
    escalate_to_operator
]
