from __future__ import annotations

import json
from typing import Any

from api.schemas import AiCommandCall


AI_COMMAND_NAMES = {
    "search_tasks",
    "open_task",
    "add_task_checkbox",
    "complete_task_checkbox",
    "create_task",
    "search_notes",
    "open_note",
    "search_snippets",
    "open_snippet",
}


def _object_schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }


def _tool(name: str, description: str, properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "strict": True,
            "parameters": _object_schema(properties, required),
        },
    }


def deepseek_tools() -> list[dict[str, Any]]:
    string = {"type": "string"}
    nullable_string = {"type": ["string", "null"]}
    return [
        _tool("search_tasks", "Search user tasks by title.", {"query": string}, ["query"]),
        _tool(
            "open_task",
            "Open/show one task by UUID or search query.",
            {"task_uuid": nullable_string, "query": nullable_string},
        ),
        _tool(
            "add_task_checkbox",
            "Add a new checkbox to a task.",
            {
                "task_uuid": nullable_string,
                "task_ref": {"type": ["string", "null"], "enum": ["current", None]},
                "text": string,
            },
            ["text"],
        ),
        _tool(
            "complete_task_checkbox",
            "Mark a task checkbox completed by UUID or text query.",
            {
                "task_uuid": nullable_string,
                "task_ref": {"type": ["string", "null"], "enum": ["current", None]},
                "checkbox_uuid": nullable_string,
                "query": nullable_string,
            },
        ),
        _tool(
            "create_task",
            "Create a task with optional root-level checkboxes.",
            {"title": string, "checkboxes": {"type": "array", "items": string}},
            ["title"],
        ),
        _tool("search_notes", "Search user notes by title or content.", {"query": string}, ["query"]),
        _tool(
            "open_note",
            "Open/show one note by UUID or search query.",
            {"note_uuid": nullable_string, "query": nullable_string},
        ),
        _tool("search_snippets", "Search user snippets by name, value, or description.", {"query": string}, ["query"]),
        _tool(
            "open_snippet",
            "Open/show one snippet by UUID or search query.",
            {"snippet_uuid": nullable_string, "query": nullable_string},
        ),
    ]


def validate_command_call(call: dict[str, Any]) -> AiCommandCall:
    """Validate an app-level command or an OpenAI/DeepSeek tool call."""
    if "function" in call:
        fn = call.get("function") or {}
        name = fn.get("name")
        raw_args = fn.get("arguments") or {}
        if isinstance(raw_args, str):
            try:
                args = json.loads(raw_args or "{}")
            except json.JSONDecodeError as exc:
                raise ValueError("invalid ai command arguments") from exc
        else:
            args = raw_args
    else:
        name = call.get("name")
        args = call.get("args") or {}

    if name not in AI_COMMAND_NAMES:
        raise ValueError(f"unsupported ai command: {name}")
    if not isinstance(args, dict):
        raise ValueError("ai command args must be an object")
    return AiCommandCall(name=name, args=args)
