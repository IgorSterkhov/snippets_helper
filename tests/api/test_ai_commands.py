import pytest

from api.ai_commands import deepseek_tools, validate_command_call


def test_validate_command_call_accepts_known_command():
    call = validate_command_call({"name": "open_task", "args": {"query": "Аптека"}})

    assert call.name == "open_task"
    assert call.args == {"query": "Аптека"}


def test_validate_command_call_rejects_unknown_command():
    with pytest.raises(ValueError, match="unsupported ai command"):
        validate_command_call({"name": "delete_task", "args": {"query": "Аптека"}})


def test_deepseek_tools_do_not_include_destructive_commands():
    names = {tool["function"]["name"] for tool in deepseek_tools()}

    assert "delete_task" not in names
    assert "delete_note" not in names
    assert "create_share_link" not in names
    assert {"open_task", "add_task_checkbox", "create_task"}.issubset(names)


def test_deepseek_tools_use_strict_function_schemas():
    for tool in deepseek_tools():
        assert tool["type"] == "function"
        assert tool["function"]["strict"] is True
        assert tool["function"]["parameters"]["type"] == "object"
        assert tool["function"]["parameters"]["additionalProperties"] is False


def test_complete_checkbox_tool_has_separate_task_and_checkbox_queries():
    tool = next(t for t in deepseek_tools() if t["function"]["name"] == "complete_task_checkbox")
    props = tool["function"]["parameters"]["properties"]

    assert "task_query" in props
    assert "checkbox_query" in props
