from __future__ import annotations

from api.schemas import AiContext


SYSTEM_PROMPT = """
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
