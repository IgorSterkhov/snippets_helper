from api.models import User


def test_user_model_has_admin_and_limit_columns():
    columns = User.__table__.columns
    assert "is_admin" in columns
    assert "last_seen_at" in columns
    assert "media_quota_bytes" in columns
    assert "media_max_upload_bytes" in columns


def test_user_model_has_deepseek_provider_columns():
    columns = User.__table__.columns
    assert "deepseek_api_key" in columns
    assert "deepseek_updated_at" in columns
