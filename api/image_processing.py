import hashlib
from dataclasses import dataclass
from io import BytesIO

from PIL import Image, UnidentifiedImageError


SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP"}


@dataclass(frozen=True)
class ImageVariant:
    variant: str
    content: bytes
    mime_type: str
    width: int
    height: int
    sha256: str


class ImageProcessingError(ValueError):
    pass


def _decode_image(content: bytes) -> Image.Image:
    try:
        img = Image.open(BytesIO(content))
        img.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ImageProcessingError("invalid image") from exc
    if img.format not in SUPPORTED_FORMATS:
        raise ImageProcessingError("unsupported image type")
    return img


def validate_image_bytes(content: bytes) -> tuple[int, int]:
    img = _decode_image(content)
    return img.size


def _render_webp(img: Image.Image, max_width: int | None, quality: int) -> ImageVariant:
    work = img.convert("RGB")
    if max_width and work.width > max_width:
        height = max(1, round(work.height * (max_width / work.width)))
        work = work.resize((max_width, height), Image.Resampling.LANCZOS)
    out = BytesIO()
    work.save(out, format="WEBP", quality=quality, method=6)
    data = out.getvalue()
    return ImageVariant(
        variant="",
        content=data,
        mime_type="image/webp",
        width=work.width,
        height=work.height,
        sha256=hashlib.sha256(data).hexdigest(),
    )


def generate_variants(content: bytes, include_original: bool = True) -> list[ImageVariant]:
    img = _decode_image(content)
    specs = [
        ("small", 960, 68),
        ("balanced", 1600, 76),
        ("readable", 2200, 88),
    ]
    if include_original:
        specs.append(("original", None, 95))

    variants = []
    for name, max_width, quality in specs:
        rendered = _render_webp(img, max_width, quality)
        variants.append(
            ImageVariant(
                variant=name,
                content=rendered.content,
                mime_type=rendered.mime_type,
                width=rendered.width,
                height=rendered.height,
                sha256=rendered.sha256,
            )
        )
    return variants
