from __future__ import annotations

from typing import Any

import httpx

from api import config
from api.ai_commands import validate_command_call
from api.schemas import AiCommandCall


class DeepSeekError(RuntimeError):
    pass


class DeepSeekClient:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.api_key = api_key if api_key is not None else config.DEEPSEEK_API_KEY
        self.base_url = (base_url if base_url is not None else config.DEEPSEEK_BASE_URL).rstrip("/")
        self.model = model or config.DEEPSEEK_MODEL
        self.timeout = timeout if timeout is not None else config.DEEPSEEK_TIMEOUT_SECONDS
        self.http_client = http_client

    async def chat(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> tuple[str, list[AiCommandCall]]:
        if not self.api_key:
            raise DeepSeekError("DeepSeek API key is not configured")

        payload = {
            "model": self.model,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto",
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}

        if self.http_client:
            response = await self.http_client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=headers,
                timeout=self.timeout,
            )
        else:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                    timeout=self.timeout,
                )

        if response.status_code >= 400:
            raise DeepSeekError(f"DeepSeek HTTP {response.status_code}: {response.text[:500]}")
        return parse_deepseek_response(response.json())


def parse_deepseek_response(data: dict[str, Any]) -> tuple[str, list[AiCommandCall]]:
    choices = data.get("choices") or []
    if not choices:
        return "", []

    message = (choices[0] or {}).get("message") or {}
    content = message.get("content") or ""
    commands = []
    for call in message.get("tool_calls") or []:
        commands.append(validate_command_call(call))
    return content, commands
