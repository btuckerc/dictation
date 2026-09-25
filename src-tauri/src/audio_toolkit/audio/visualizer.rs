use rustfft::{num_complex::Complex32, Fft, FftPlanner};
use std::sync::Arc;

// `db` below is not true dBFS: it's a per-bin average divided by the FFT
// window size, which lands ~30-40 dB below the signal's RMS dBFS for speech.
//
// A fixed dB window (the old -68..-30) only suits one microphone gain: on a
// quieter laptop mic normal speech sat at 10-30% of the bar height. Instead
// each bucket's window tops out at its own loudest recent level (instant
// attack, slow release), so ordinary speech fills the waveform at any input
// gain while relative loudness between words is kept.
//
// Per-bucket references matter because voice energy is concentrated in a few
// low bands: with one shared reference the vowel bands always won and the
// consonant bands (s, sh, f, t) never rose. A bucket may sit at most
// `DB_BUCKET_GAP` below the loudest one, so a band that is merely noise is
// never stretched to full height. Silero's gate in the recorder still zeroes
// non-speech frames; the silence floor keeps room tone flat when VAD is off.
/// Anything quieter than this is drawn at rest (≈ -60 dBFS broadband room tone).
const DB_SILENCE: f32 = -90.0;
/// References never drop below this, so near-silence isn't stretched to full
/// height.
const DB_REFERENCE_FLOOR: f32 = -70.0;
/// Dynamic range shown beneath a reference.
const DB_RANGE: f32 = 36.0;
/// Furthest a bucket's reference may sit below the loudest bucket's.
const DB_BUCKET_GAP: f32 = 15.0;
/// How fast references fall back after a loud peak.
const RELEASE_DB_PER_SEC: f32 = 10.0;
/// Speech energy falls with frequency; lift upper buckets so they compete
/// fairly for the `DB_BUCKET_GAP` allowance.
const TILT_DB_PER_OCTAVE: f32 = 4.0;
const CURVE_POWER: f32 = 0.7;

pub struct AudioVisualiser {
    fft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    bucket_ranges: Vec<(usize, usize)>,
    fft_input: Vec<Complex32>,
    bucket_tilt_db: Vec<f32>,
    bucket_reference_db: Vec<f32>,
    release_per_frame_db: f32,
    buffer: Vec<f32>,
    window_size: usize,
    buckets: usize,
}

impl AudioVisualiser {
    pub fn new(
        sample_rate: u32,
        window_size: usize,
        buckets: usize,
        freq_min: f32,
        freq_max: f32,
    ) -> Self {
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(window_size);

        // Pre-compute Hann window
        let window: Vec<f32> = (0..window_size)
            .map(|i| {
                0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / window_size as f32).cos())
            })
            .collect();

        // Pre-compute bucket frequency ranges
        let nyquist = sample_rate as f32 / 2.0;
        let freq_min = freq_min.min(nyquist);
        let freq_max = freq_max.min(nyquist);

        let mut bucket_ranges = Vec::with_capacity(buckets);
        let mut bucket_tilt_db = Vec::with_capacity(buckets);

        for b in 0..buckets {
            // Logarithmic (equal-octave) spacing, as in audio spectrum
            // analysers: each bucket covers the same musical interval.
            let ratio = freq_max / freq_min.max(1.0);
            let start_hz = freq_min * ratio.powf(b as f32 / buckets as f32);
            let end_hz = freq_min * ratio.powf((b + 1) as f32 / buckets as f32);

            let start_bin = ((start_hz * window_size as f32) / sample_rate as f32) as usize;
            let mut end_bin = ((end_hz * window_size as f32) / sample_rate as f32) as usize;

            // Ensure each bucket has at least one bin
            if end_bin <= start_bin {
                end_bin = start_bin + 1;
            }

            // Clamp to valid range
            let start_bin = start_bin.min(window_size / 2);
            let end_bin = end_bin.min(window_size / 2);

            bucket_ranges.push((start_bin, end_bin));
            let octaves = (0.5 * (start_hz + end_hz) / freq_min.max(1.0))
                .max(1.0)
                .log2();
            bucket_tilt_db.push(TILT_DB_PER_OCTAVE * octaves);
        }

        Self {
            fft,
            window,
            bucket_ranges,
            fft_input: vec![Complex32::new(0.0, 0.0); window_size],
            bucket_tilt_db,
            bucket_reference_db: vec![DB_REFERENCE_FLOOR; buckets],
            release_per_frame_db: RELEASE_DB_PER_SEC * window_size as f32 / sample_rate as f32,
            buffer: Vec::with_capacity(window_size * 2),
            window_size,
            buckets,
        }
    }

    pub fn feed(&mut self, samples: &[f32]) -> Option<Vec<f32>> {
        // Add new samples to buffer
        self.buffer.extend_from_slice(samples);

        // Only process if we have enough samples
        if self.buffer.len() < self.window_size {
            return None;
        }

        // Take the required window of samples
        let window_samples = &self.buffer[..self.window_size];

        // Remove DC component
        let mean = window_samples.iter().sum::<f32>() / self.window_size as f32;

        // Apply window function and prepare FFT input
        for (i, &sample) in window_samples.iter().enumerate() {
            let windowed_sample = (sample - mean) * self.window[i];
            self.fft_input[i] = Complex32::new(windowed_sample, 0.0);
        }

        // Perform FFT
        self.fft.process(&mut self.fft_input);

        // Bucket levels in dB (tilt-compensated). Unusable buckets stay at
        // -inf so they neither drive the reference nor draw.
        let mut buckets = vec![f32::NEG_INFINITY; self.buckets];

        for (bucket_idx, &(start_bin, end_bin)) in self.bucket_ranges.iter().enumerate() {
            if start_bin >= end_bin || end_bin > self.fft_input.len() / 2 {
                continue;
            }

            // Calculate average power in this frequency range
            let mut power_sum = 0.0;
            for bin_idx in start_bin..end_bin {
                power_sum += self.fft_input[bin_idx].norm_sqr();
            }

            let avg_power = power_sum / (end_bin - start_bin) as f32;
            if avg_power <= 1e-12 {
                continue;
            }
            buckets[bucket_idx] = 20.0 * (avg_power.sqrt() / self.window_size as f32).log10()
                + self.bucket_tilt_db[bucket_idx];
        }

        // Instant attack, linear-in-dB release, never below the floor.
        let mut top_db = DB_REFERENCE_FLOOR;
        for (reference, &db) in self.bucket_reference_db.iter_mut().zip(&buckets) {
            *reference = db
                .max(*reference - self.release_per_frame_db)
                .max(DB_REFERENCE_FLOOR);
            top_db = top_db.max(*reference);
        }
        for (level, &reference) in buckets.iter_mut().zip(&self.bucket_reference_db) {
            let reference = reference.max(top_db - DB_BUCKET_GAP);
            let low_db = (reference - DB_RANGE).max(DB_SILENCE);
            *level = ((*level - low_db) / (reference - low_db))
                .clamp(0.0, 1.0)
                .powf(CURVE_POWER);
        }

        // Apply light smoothing to reduce jitter
        for i in 1..buckets.len() - 1 {
            buckets[i] = buckets[i] * 0.7 + buckets[i - 1] * 0.15 + buckets[i + 1] * 0.15;
        }

        // Clear processed samples from buffer
        self.buffer.clear();

        Some(buckets)
    }

    pub fn reset(&mut self) {
        self.buffer.clear();
        self.bucket_reference_db.fill(DB_REFERENCE_FLOOR);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;
    const WINDOW: usize = 2048;

    fn visualiser() -> AudioVisualiser {
        AudioVisualiser::new(RATE, WINDOW, 16, 150.0, 8000.0)
    }

    /// Voiced-speech stand-in: 140 Hz fundamental with 1/k harmonics, scaled
    /// to the requested RMS dBFS.
    fn voice(dbfs: f32, frames: usize) -> Vec<f32> {
        let raw: Vec<f32> = (0..WINDOW * frames)
            .map(|n| {
                let t = n as f32 / RATE as f32;
                (1..=28)
                    .map(|k| (2.0 * std::f32::consts::PI * 140.0 * k as f32 * t).sin() / k as f32)
                    .sum()
            })
            .collect();
        let rms = (raw.iter().map(|s| s * s).sum::<f32>() / raw.len() as f32).sqrt();
        let gain = 10f32.powf(dbfs / 20.0) / rms;
        raw.into_iter().map(|s| s * gain).collect()
    }

    fn last_frame(vis: &mut AudioVisualiser, samples: &[f32]) -> Vec<f32> {
        samples
            .chunks(WINDOW)
            .filter_map(|chunk| vis.feed(chunk))
            .last()
            .expect("at least one frame")
    }

    fn mean(levels: &[f32]) -> f32 {
        levels.iter().sum::<f32>() / levels.len() as f32
    }

    #[test]
    fn normal_speech_fills_the_waveform_at_any_mic_gain() {
        let loud = last_frame(&mut visualiser(), &voice(-20.0, 4));
        let quiet = last_frame(&mut visualiser(), &voice(-42.0, 4));
        for levels in [&loud, &quiet] {
            // Neighbour smoothing keeps the loudest bucket just under 1.0.
            assert!(
                levels.iter().cloned().fold(0.0, f32::max) > 0.9,
                "{levels:?}"
            );
            assert!(mean(levels) > 0.4, "{levels:?}");
        }
        // Near the silence floor the window narrows slightly; stay within 0.1.
        assert!(
            (mean(&loud) - mean(&quiet)).abs() < 0.1,
            "{loud:?}\n{quiet:?}"
        );
    }

    #[test]
    fn room_tone_stays_at_rest() {
        // Deterministic white noise at -75 dBFS RMS.
        let mut state = 0x1234_5678u32;
        let noise: Vec<f32> = (0..WINDOW * 4)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (state as f32 / u32::MAX as f32 * 2.0 - 1.0)
                    * 10f32.powf(-75.0 / 20.0)
                    * 3f32.sqrt()
            })
            .collect();
        let levels = last_frame(&mut visualiser(), &noise);
        assert!(levels.iter().all(|&l| l < 0.05), "{levels:?}");
    }

    #[test]
    fn softer_word_after_a_loud_one_draws_lower_then_recovers() {
        let mut vis = visualiser();
        last_frame(&mut vis, &voice(-20.0, 4));
        let soft = voice(-32.0, 120); // ~5 s
        let mut frames = soft.chunks(WINDOW).filter_map(|chunk| vis.feed(chunk));
        let first = frames.next().unwrap();
        let settled = frames.last().unwrap();
        let peak = |l: &[f32]| l.iter().cloned().fold(0.0, f32::max);
        assert!(peak(&first) < 0.9, "{first:?}");
        assert!(peak(&settled) > 0.95, "{settled:?}");
    }

    #[test]
    fn consonant_bands_rise_even_while_vowels_are_louder() {
        // An "s" stand-in: equal-amplitude partials across 5-8 kHz, far
        // quieter than the vowel. It must still drive the top buckets.
        let hiss: Vec<f32> = (0..WINDOW * 6)
            .map(|n| {
                let t = n as f32 / RATE as f32;
                (0..60)
                    .map(|k| {
                        let hz = 5_000.0 + 50.0 * k as f32;
                        (2.0 * std::f32::consts::PI * hz * t + k as f32 * 2.4).sin()
                    })
                    .sum::<f32>()
                    * 10f32.powf(-50.0 / 20.0)
                    / 60f32.sqrt()
            })
            .collect();
        let mut vis = visualiser();
        let vowel_only = last_frame(&mut vis, &voice(-20.0, 6));
        let with_hiss: Vec<f32> = voice(-20.0, 6)
            .iter()
            .zip(&hiss)
            .map(|(v, s)| v + s)
            .collect();
        let mixed = last_frame(&mut vis, &with_hiss);
        assert!(vowel_only[15] < 0.3, "{vowel_only:?}");
        // Neighbour smoothing with the quieter bucket below trims the top.
        assert!(mixed[15] > 0.7, "{mixed:?}");
    }
}
