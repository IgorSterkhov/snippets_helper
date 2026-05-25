from io import BytesIO

import pytest
from PIL import Image

from api.image_processing import ImageProcessingError, generate_variants, validate_image_bytes


def png_bytes(width=128, height=64):
    out = BytesIO()
    Image.new("RGB", (width, height), color=(220, 40, 40)).save(out, format="PNG")
    return out.getvalue()


def test_validate_image_bytes_decodes_dimensions():
    assert validate_image_bytes(png_bytes()) == (128, 64)


def test_generate_variants_returns_expected_metadata():
    variants = generate_variants(png_bytes(2400, 1200))
    names = [v.variant for v in variants]
    assert names == ["small", "balanced", "readable", "original"]
    balanced = next(v for v in variants if v.variant == "balanced")
    assert balanced.width == 1600
    assert balanced.height == 800
    assert balanced.mime_type == "image/webp"
    assert balanced.content
    assert len(balanced.sha256) == 64


def test_generate_variants_rejects_invalid_bytes():
    with pytest.raises(ImageProcessingError):
        generate_variants(b"not an image")
