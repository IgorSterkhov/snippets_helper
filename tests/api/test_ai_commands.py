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
    assert {"open_task", "show_task", "add_task_checkbox", "create_task"}.issubset(names)


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


def test_add_checkbox_tool_accepts_named_task_target():
    tool = next(t for t in deepseek_tools() if t["function"]["name"] == "add_task_checkbox")
    props = tool["function"]["parameters"]["properties"]

    assert "task_uuid" in props
    assert "task_query" in props
    assert "query" in props
    assert "text" in props


def test_show_task_tool_is_read_only_task_summary_command():
    tool = next(t for t in deepseek_tools() if t["function"]["name"] == "show_task")
    fn = tool["function"]
    props = fn["parameters"]["properties"]

    assert "readable task summary" in fn["description"].lower()
    assert set(props) == {"task_uuid", "query"}
    assert validate_command_call({"name": "show_task", "args": {"query": "Аптека"}}).name == "show_task"
