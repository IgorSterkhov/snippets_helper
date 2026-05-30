import asyncio

from api.deepseek_client import DeepSeekClient, parse_deepseek_response


def test_parse_deepseek_response_extracts_tool_calls():
    reply, commands = parse_deepseek_response(
        {
            "choices": [
                {
                    "message": {
                        "content": "Открою задачу.",
                        "tool_calls": [
                            {
                                "type": "function",
                                "function": {
                                    "name": "open_task",
                                    "arguments": '{"query":"Аптека"}',
                                },
                            }
                        ],
                    }
                }
            ]
        }
    )

    assert reply == "Открою задачу."
    assert len(commands) == 1
    assert commands[0].name == "open_task"
    assert commands[0].args == {"query": "Аптека"}


def test_parse_deepseek_response_rejects_unknown_tool_call():
    try:
        parse_deepseek_response(
            {
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "type": "function",
                                    "function": {
                                        "name": "delete_task",
                                        "arguments": '{"query":"Аптека"}',
                                    },
                                }
                            ]
                        }
                    }
                ]
            }
        )
    except ValueError as exc:
        assert "unsupported ai command" in str(exc)
    else:
        raise AssertionError("unknown tool call was accepted")


class FakeResponse:
    status_code = 200
    text = "ok"

    def json(self):
        return {
            "is_available": True,
            "balance_infos": [
                {
                    "currency": "CNY",
                    "total_balance": "12.50",
                    "granted_balance": "2.50",
                    "topped_up_balance": "10.00",
                }
            ],
        }


class FakeHttpClient:
    def __init__(self):
        self.calls = []

    async def get(self, url, *, headers, timeout):
        self.calls.append({
            "url": url,
            "headers": headers,
            "timeout": timeout,
        })
        return FakeResponse()


def test_deepseek_balance_calls_user_balance_endpoint_with_bearer_key():
    http = FakeHttpClient()
    client = DeepSeekClient(
        api_key="sk-user-key",
        base_url="https://api.deepseek.test",
        timeout=7,
        http_client=http,
    )

    balance = asyncio.run(client.balance())

    assert http.calls == [{
        "url": "https://api.deepseek.test/user/balance",
        "headers": {"Authorization": "Bearer sk-user-key"},
        "timeout": 7,
    }]
    assert balance["is_available"] is True
    assert balance["balance_infos"][0]["currency"] == "CNY"
