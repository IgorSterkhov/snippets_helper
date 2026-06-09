import pytest
from fastapi import HTTPException

from api.routes.media import _validate_html_upload


def test_validate_html_upload_accepts_utf8_html():
    name, content = _validate_html_upload(
        "deck.html",
        "<!doctype html><html><body>Привет</body></html>".encode("utf-8"),
    )

    assert name == "deck.html"
    assert content == "<!doctype html><html><body>Привет</body></html>".encode("utf-8")


def test_validate_html_upload_rejects_non_html_extension():
    with pytest.raises(HTTPException) as exc:
        _validate_html_upload("deck.txt", b"<html></html>")

    assert exc.value.status_code == 400
    assert "only .html" in exc.value.detail


def test_validate_html_upload_rejects_non_utf8():
    with pytest.raises(HTTPException) as exc:
        _validate_html_upload("deck.html", b"\xff<html></html>")

    assert exc.value.status_code == 400
    assert "UTF-8" in exc.value.detail
