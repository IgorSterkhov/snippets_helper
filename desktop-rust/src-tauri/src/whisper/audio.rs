//! Audio capture (cpal) + WAV encoding (hound) + RMS emission.

use cpal::traits::{DeviceTrait, HostTrait};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputDevice {
    pub name: String,
    pub is_default: bool,
}

pub fn list_input_devices() -> Vec<InputDevice> {
    let host = cpal::default_host();
    let default_name = host.default_input_device().and_then(|d| d.name().ok());

    let devices = match host.input_devices() {
        Ok(it) => it,
        Err(_) => return Vec::new(),
    };

    devices
        .filter_map(|d| {
            let name = d.name().ok()?;
            Some(InputDevice {
                is_default: Some(&name) == default_name.as_ref(),
                name,
            })
        })
        .collect()
}

use cpal::traits::StreamTrait;
use cpal::{SampleFormat, StreamConfig};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use crate::whisper::events::{self, LevelPayload};

pub const WAV_SAMPLE_RATE: u32 = 16_000;
pub const WAV_CHANNELS: u16 = 1;

/// Owns the live stream + buffer. Dropping stops the stream.
pub struct Recorder {
    _stream: cpal::Stream, // Drop stops it
    buffer: Arc<Mutex<Vec<i16>>>,
    started_at: Instant,
}

impl Recorder {
    /// Start a new recorder bound to the given device (by name).
    /// Pass `None` to use the OS default. Emits `whisper:level` events.
    pub fn start(app: AppHandle, device_name: Option<&str>) -> Result<Self, String> {
        let host = cpal::default_host();
        let device = match device_name {
            None => host.default_input_device()
                .ok_or_else(|| "no default input device".to_string())?,
            Some(name) => host.input_devices()
                .map_err(|e| format!("enum: {e}"))?
                .find(|d| d.name().ok().as_deref() == Some(name))
                .ok_or_else(|| format!("device not found: {name}"))?,
        };

        let default_config = device.default_input_config()
            .map_err(|e| format!("default config: {e}"))?;
        let sample_format = default_config.sample_format();
        let sample_rate = default_config.sample_rate().0;
        let channels = default_config.channels();
        let config: StreamConfig = default_config.into();

        let buffer: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(Vec::with_capacity(16_000 * 30)));
        let emit_every: usize = (sample_rate as usize / 20).max(100);
        let err_fn = |e| eprintln!("[whisper audio] stream error: {e}");

        // NB: per-stream accumulators live INSIDE each match arm's `move` closure —
        // otherwise multiple `move` closures would try to own them, which won't
        // compile.
        let stream = match sample_format {
            SampleFormat::F32 => {
                let buf_for_cb = buffer.clone();
                let app_for_cb = app.clone();
                let mut since_emit: usize = 0;
                let mut rms_sq: f64 = 0.0;
                let mut rms_n: usize = 0;
                device.build_input_stream(
                    &config,
                    move |data: &[f32], _| {
                        process_frames_f32(
                            data, sample_rate, channels,
                            &buf_for_cb, &app_for_cb,
                            &mut since_emit, emit_every,
                            &mut rms_sq, &mut rms_n,
                        );
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::I16 => {
                let buf_for_cb = buffer.clone();
                let app_for_cb = app.clone();
                let mut since_emit: usize = 0;
                let mut rms_sq: f64 = 0.0;
                let mut rms_n: usize = 0;
                device.build_input_stream(
                    &config,
                    move |data: &[i16], _| {
                        process_frames_i16(
                            data, sample_rate, channels,
                            &buf_for_cb, &app_for_cb,
                            &mut since_emit, emit_every,
                            &mut rms_sq, &mut rms_n,
                        );
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::U16 => {
                let buf_for_cb = buffer.clone();
                let app_for_cb = app.clone();
                let mut since_emit: usize = 0;
                let mut rms_sq: f64 = 0.0;
                let mut rms_n: usize = 0;
                device.build_input_stream(
                    &config,
                    move |data: &[u16], _| {
                        let mapped: Vec<i16> = data.iter()
                            .map(|&s| (s as i32 - 32_768) as i16)
                            .collect();
                        process_frames_i16(
                            &mapped, sample_rate, channels,
                            &buf_for_cb, &app_for_cb,
                            &mut since_emit, emit_every,
                            &mut rms_sq, &mut rms_n,
                        );
                    },
                    err_fn,
                    None,
                )
            }
            other => return Err(format!("unsupported sample format: {:?}", other)),
        }.map_err(|e| format!("build_input_stream: {e}"))?;

        stream.play().map_err(|e| format!("stream.play: {e}"))?;

        Ok(Self {
            _stream: stream,
            buffer,
            started_at: Instant::now(),
        })
    }

    pub fn duration_ms(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }

    /// Consume the recorder and return a WAV byte buffer (16kHz mono i16 PCM).
    ///
    /// We explicitly destructure so the stream is dropped (stopping the
    /// cpal callback thread) BEFORE we touch the buffer. Even then the
    /// callback thread may own an extra `Arc` clone for a few ms, so we
    /// don't use `Arc::try_unwrap` — instead we lock the mutex and clone
    /// the samples out. Extra copy of the PCM vector is cheap next to the
    /// whisper inference that follows.
    pub fn finish_wav(self) -> Result<Vec<u8>, String> {
        let Self { _stream, buffer, .. } = self;
        drop(_stream);
        let samples = buffer
            .lock()
            .map_err(|e| format!("mutex poisoned: {e}"))?
            .clone();
        encode_wav(&samples)
    }
}

fn encode_wav(samples: &[i16]) -> Result<Vec<u8>, String> {
    let spec = hound::WavSpec {
        channels: WAV_CHANNELS,
        sample_rate: WAV_SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut out: Vec<u8> = Vec::with_capacity(samples.len() * 2 + 44);
    let cursor = std::io::Cursor::new(&mut out);
    let mut writer = hound::WavWriter::new(cursor, spec)
        .map_err(|e| format!("wav init: {e}"))?;
    for s in samples {
        writer.write_sample(*s).map_err(|e| format!("wav write: {e}"))?;
    }
    writer.finalize().map_err(|e| format!("wav finalize: {e}"))?;
    Ok(out)
}

fn process_frames_f32(
    data: &[f32],
    in_sample_rate: u32,
    in_channels: u16,
    buffer: &Arc<Mutex<Vec<i16>>>,
    app: &AppHandle,
    since_emit: &mut usize,
    emit_every: usize,
    rms_sq: &mut f64,
    rms_n: &mut usize,
) {
    // Mix-down to mono f32
    let mono: Vec<f32> = if in_channels == 1 {
        data.to_vec()
    } else {
        let c = in_channels as usize;
        data.chunks_exact(c)
            .map(|ch| ch.iter().sum::<f32>() / c as f32)
            .collect()
    };
    // Resample to 16kHz by linear interpolation
    let resampled = resample_linear_f32(&mono, in_sample_rate, WAV_SAMPLE_RATE);
    let i16s: Vec<i16> = resampled.iter()
        .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
        .collect();

    for &s in &mono {
        *rms_sq += (s as f64) * (s as f64);
        *rms_n += 1;
    }
    *since_emit += mono.len();
    if *since_emit >= emit_every && *rms_n > 0 {
        let rms = ((*rms_sq / *rms_n as f64).sqrt() as f32).clamp(0.0, 1.0);
        let _ = app.emit(events::EVT_LEVEL, LevelPayload { rms });
        *since_emit = 0;
        *rms_sq = 0.0;
        *rms_n = 0;
    }

    if let Ok(mut buf) = buffer.lock() {
        buf.extend_from_slice(&i16s);
    }
}

fn process_frames_i16(
    data: &[i16],
    in_sample_rate: u32,
    in_channels: u16,
    buffer: &Arc<Mutex<Vec<i16>>>,
    app: &AppHandle,
    since_emit: &mut usize,
    emit_every: usize,
    rms_sq: &mut f64,
    rms_n: &mut usize,
) {
    let f32_data: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
    process_frames_f32(
        &f32_data, in_sample_rate, in_channels, buffer, app,
        since_emit, emit_every, rms_sq, rms_n,
    );
}

/// Linear-interpolation resampler — fine for speech.
pub fn resample_linear_f32(input: &[f32], from_hz: u32, to_hz: u32) -> Vec<f32> {
    if from_hz == to_hz || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from_hz as f64 / to_hz as f64;
    let out_len = (input.len() as f64 / ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = (i as f64) * ratio;
        let lo = src.floor() as usize;
        let hi = (lo + 1).min(input.len() - 1);
        let frac = (src - lo as f64) as f32;
        let v = input[lo] * (1.0 - frac) + input[hi] * frac;
        out.push(v);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_does_not_panic() {
        // On CI/Docker there may be zero input devices — acceptable.
        let _ = list_input_devices();
    }

    #[test]
    fn resample_identity_when_rates_match() {
        let samples = vec![0.1, 0.2, 0.3, 0.4];
        assert_eq!(resample_linear_f32(&samples, 16_000, 16_000), samples);
    }

    #[test]
    fn resample_downsamples_length() {
        let samples: Vec<f32> = (0..48_000).map(|i| (i as f32) / 48_000.0).collect();
        let out = resample_linear_f32(&samples, 48_000, 16_000);
        // From 48kHz to 16kHz: ~3x reduction
        assert!((out.len() as i32 - 16_000).abs() < 5, "got {}", out.len());
    }

    #[test]
    fn encode_wav_produces_valid_header() {
        let samples: Vec<i16> = (0..16_000).map(|i| (i as i16).wrapping_mul(10)).collect();
        let bytes = encode_wav(&samples).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert!(bytes.len() >= 32_000 + 40, "got {} bytes", bytes.len());
    }

    #[test]
    fn encode_wav_roundtrip_via_hound_reader() {
        let samples: Vec<i16> = vec![100, -100, 200, -200, 0];
        let bytes = encode_wav(&samples).unwrap();
        let cursor = std::io::Cursor::new(bytes);
        let reader = hound::WavReader::new(cursor).unwrap();
        let spec = reader.spec();
        assert_eq!(spec.sample_rate, WAV_SAMPLE_RATE);
        assert_eq!(spec.channels, WAV_CHANNELS);
        let decoded: Vec<i16> = reader.into_samples::<i16>().filter_map(|r| r.ok()).collect();
        assert_eq!(decoded, samples);
    }
}
