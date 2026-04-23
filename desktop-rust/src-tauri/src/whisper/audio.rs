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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_does_not_panic() {
        // On CI/Docker there may be zero input devices — acceptable.
        let _ = list_input_devices();
    }
}
