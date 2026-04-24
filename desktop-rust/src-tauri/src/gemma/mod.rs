//! Local LLM sidecar (llama.cpp's `llama-server`) used for post-processing
//! Whisper voice transcripts.
//!
//! Mirrors the structure of `crate::whisper`: catalog + models registry
//! (downloaded from HuggingFace), server (spawn / TCP probe / shutdown),
//! service (lazy warm with idle-unload), postprocess (prompt + HTTP call).

pub mod catalog;
pub mod models;
pub mod postprocess;
pub mod server;
pub mod service;
