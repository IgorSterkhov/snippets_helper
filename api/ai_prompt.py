from __future__ import annotations

from api.schemas import AiContext


CORE_INSTRUCTIONS = """
You are an AI controller for Snippets Helper.
You may answer normally, or call one of the provided tools.
Use tools only for supported low-risk actions.
Never invent UUIDs. If the target is ambiguous, ask for clarification.
Do not request destructive actions; deletion and bulk edits are unavailable.
For task checkbox commands, separate the task lookup from the checkbox lookup:
use task_query for the task title and checkbox_query for the checkbox text.
Example: "in task Аптека mark Купить уголь done" should call
complete_task_checkbox with task_query="Аптека" and checkbox_query="Купить уголь".
""".strip()

SAFETY_RULES = [
    "Never invent UUIDs.",
    "Ask for clarification when a target is ambiguous.",
    "Do not request destructive actions; deletion and bulk edits are unavailable.",
    "Use task_query for the task title and checkbox_query for the checkbox text.",
]

CONTEXT_FIELD_DESCRIPTIONS = {
    "module": "Current app module or channel.",
    "current_task_uuid": "Task currently open in the UI, when known.",
    "current_note_uuid": "Note currently open in the UI, when known.",
    "current_snippet_uuid": "Snippet currently open in the UI, when known.",
    "recent_task_uuid": "Last task opened or modified by AI commands.",
    "locale": "Preferred response language inferred from the app/user.",
}

TELEGRAM_NOTES = [
    'In Telegram, "show/open task" should use show_task so the bot can reply with task details.',
    "Telegram cannot navigate desktop or mobile UI; it can only reply and execute server-side supported commands.",
]


def normalize_custom_instructions(value: str | None, limit: int = 4000) -> str:
    return (value or "").strip()[:limit]


def build_messages(
    message: str,
    context: AiContext,
    *,
    custom_instructions: str | None = None,
    channel: str = "client",
) -> list[dict[str, str]]:
    context_text = {
        "module": context.module,
        "current_task_uuid": context.current_task_uuid,
        "current_note_uuid": context.current_note_uuid,
        "current_snippet_uuid": context.current_snippet_uuid,
        "recent_task_uuid": context.recent_task_uuid,
        "locale": context.locale,
    }
    system_parts = [CORE_INSTRUCTIONS]
    if channel == "telegram":
        system_parts.append("Telegram channel notes:\n" + "\n".join(f"- {item}" for item in TELEGRAM_NOTES))
    custom = normalize_custom_instructions(custom_instructions)
    if custom:
        system_parts.append("User custom instructions:\n" + custom)
    return [
        {"role": "system", "content": "\n\n".join(system_parts)},
        {"role": "system", "content": f"Current app context: {context_text}"},
        {"role": "user", "content": message},
    ]
