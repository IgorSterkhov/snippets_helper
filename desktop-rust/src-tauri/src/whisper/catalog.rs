//! Catalog of available whisper.cpp models (ggml-format) — see spec.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelMeta {
    pub name: &'static str,           // "ggml-small", canonical file id
    pub display_name: &'static str,   // "small multilingual"
    pub size_bytes: u64,
    pub sha256: &'static str,         // lowercase hex, 64 chars
    pub download_url: &'static str,   // HuggingFace absolute URL
    pub ru_quality: u8,               // 1..5 stars
    pub recommended: bool,            // onboarding highlights this one
    pub notes: &'static str,          // short UI hint
}

/// Catalog pinned at compile time. Update by regenerating hashes from the
/// whisper.cpp manifest at:
///   https://huggingface.co/ggerganov/whisper.cpp/raw/main/ggml-<name>.bin
/// The SHA256 values below are placeholders — Task 2.2 refreshes them.
pub const CATALOG: &[ModelMeta] = &[
    ModelMeta {
        name: "ggml-tiny",
        display_name: "tiny",
        size_bytes: 77_691_712,
        sha256: "bd577a113a864445d4c299885e0cb97d4ba92b5f",
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        ru_quality: 1,
        recommended: false,
        notes: "Fast but poor for Russian",
    },
    ModelMeta {
        name: "ggml-base",
        display_name: "base",
        size_bytes: 147_951_616,
        sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf",
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        ru_quality: 2,
        recommended: false,
        notes: "Weak for Russian",
    },
    ModelMeta {
        name: "ggml-small",
        display_name: "small (multilingual)",
        size_bytes: 487_601_967,
        sha256: "1be3a9b2063867b937e64e2ec7483364a79917e9",
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        ru_quality: 4,
        recommended: true,
        notes: "Best tradeoff for RU+EN",
    },
    ModelMeta {
        name: "ggml-medium",
        display_name: "medium",
        size_bytes: 1_533_763_059,
        sha256: "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
        ru_quality: 5,
        recommended: false,
        notes: "Top quality if RAM allows",
    },
    ModelMeta {
        name: "ggml-large-v3",
        display_name: "large-v3",
        size_bytes: 3_095_018_317,
        sha256: "ad82bf6a9043ceed055076d0fd39f5f186ff8062",
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
        ru_quality: 5,
        recommended: false,
        notes: "Best quality, GPU recommended",
    },
    ModelMeta {
        name: "ggml-large-v3-q5_0",
        display_name: "large-v3 (Q5 quantized)",
        size_bytes: 1_080_000_000,
        sha256: "00000000000000000000000000000000",
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin",
        ru_quality: 5,
        recommended: false,
        notes: "Quantized: large-quality at ~1GB",
    },
];

pub fn find(name: &str) -> Option<&'static ModelMeta> {
    CATALOG.iter().find(|m| m.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_exactly_one_recommended() {
        let rec: Vec<_> = CATALOG.iter().filter(|m| m.recommended).collect();
        assert_eq!(rec.len(), 1, "exactly one model should be marked recommended");
        assert_eq!(rec[0].name, "ggml-small");
    }

    #[test]
    fn catalog_names_unique() {
        let mut names: Vec<&str> = CATALOG.iter().map(|m| m.name).collect();
        let len_before = names.len();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), len_before, "catalog has duplicate names");
    }

    #[test]
    fn find_returns_known_model() {
        assert!(find("ggml-small").is_some());
        assert!(find("ggml-nonexistent").is_none());
    }
}
