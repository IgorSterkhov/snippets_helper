//! Catalog of Gemma GGUF models for local post-processing.
//!
//! Refresh sizes / sha256 with:
//!   for repo in ggml-org/gemma-3-1b-it-GGUF ggml-org/gemma-3-4b-it-GGUF; do
//!     curl -s "https://huggingface.co/api/models/$repo/tree/main" | \
//!       jq -r '.[] | select(.path | test("Q4_K_M\\.gguf$"))
//!                  | "\(.path) \(.size) \(.lfs.oid)"'
//!   done

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelMeta {
    pub name: &'static str,          // canonical id, matches filename stem
    pub display_name: &'static str,
    pub size_bytes: u64,
    pub sha256: &'static str,        // lowercase hex
    pub download_url: &'static str,
    pub ru_quality: u8,              // 1..5
    pub recommended: bool,
    pub notes: &'static str,
}

pub const CATALOG: &[ModelMeta] = &[
    ModelMeta {
        name: "gemma-3-1b-it-Q4_K_M",
        display_name: "Gemma 3 1B (Q4, small)",
        size_bytes: 806_058_240,
        sha256: "8ccc5cd1f1b3602548715ae25a66ed73fd5dc68a210412eea643eb20eb75a135",
        download_url: "https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf",
        ru_quality: 3,
        recommended: false,
        notes: "~800 MB. Fast on CPU, adequate Russian cleanup.",
    },
    ModelMeta {
        name: "gemma-3-4b-it-Q4_K_M",
        display_name: "Gemma 3 4B (Q4, default)",
        size_bytes: 2_489_757_856,
        sha256: "882e8d2db44dc554fb0ea5077cb7e4bc49e7342a1f0da57901c0802ea21a0863",
        download_url: "https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf",
        ru_quality: 5,
        recommended: true,
        notes: "~2.5 GB. Solid Russian. Best tradeoff.",
    },
];

pub fn find(name: &str) -> Option<&'static ModelMeta> {
    CATALOG.iter().find(|m| m.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_exactly_one_recommended() {
        let rec: Vec<_> = CATALOG.iter().filter(|m| m.recommended).collect();
        assert_eq!(rec.len(), 1);
        assert_eq!(rec[0].name, "gemma-3-4b-it-Q4_K_M");
    }

    #[test]
    fn sha256_is_64_lowercase_hex() {
        for m in CATALOG {
            assert_eq!(m.sha256.len(), 64, "{}", m.name);
            assert!(m.sha256.chars().all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()), "{}", m.name);
        }
    }
}
