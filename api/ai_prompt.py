from __future__ import annotations

from api.schemas import AiContext


SYSTEM_PROMPT = """
You are an AI controller for Snippets Helper.
You may answer normally, or call one of the provided tools.
Use tools only for supported low-risk actions.
Never invent UUIDs. If the target is ambiguous, ask for clarification.
Do not request destructive actions; deletion and bulk edits are unavailable.
""".strip()


def build_messages(message: str, context: AiContext) -> list[dict[str, str]]:
    context_text = {
        "module": context.module,
        "current_task_uuid": context.current_task_uuid,
        "current_note_uuid": context.current_note_uuid,
        "current_snippet_uuid": context.current_snippet_uuid,
        "recent_task_uuid": context.recent_task_uuid,
        "locale": context.locale,
    }
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": f"Current app context: {context_text}"},
        {"role": "user", "content": message},
    ]
