# Dictation evaluation harness

`scripts/evaluate-dictation.py` runs named `transcribe.cpp` candidates against a
JSON manifest and writes machine-readable results. It uses only the Python
standard library and does not record from a microphone. Audio can be real user
recordings; the harness only reads paths supplied in the manifest.

The manifest has `inputs` with `path`, `reference`, and optional
`protected_terms`, plus `candidates` with a name and model path. Paths are
relative to the manifest unless absolute. A candidate with `use_vocabulary` is
given an initial prompt made from the protected terms only when it is a
Whisper candidate (`family: "whisper"`, or a name/model containing
`whisper`). This keeps vocabulary prompting out of Fast/Parakeet runs.

Example:

```sh
python3 scripts/evaluate-dictation.py evaluation/fixtures.json \
  --cli /path/to/transcribe-cli --backend metal --threads 6 \
  --output evaluation/results.json
```

The output records SHA-256 hashes for the CLI and each model, the exact command,
optional batch header, total and per-input wall time, engine timing fields
(`mel_ms`, `encode_ms`, `decode_ms` when emitted), raw transcript, normalized
word error rate, and protected-term recall. WER normalization lowercases and
removes punctuation for word comparison while retaining identifier tokens.
Protected terms are scored independently as literal, case-sensitive strings
with identifier boundaries, so `getUserByID` differs from `getuserbyid`, and a
substring such as `SQL` does not count inside `PostgreSQL`.
Each candidate also includes weighted aggregate WER and protected-term recall
so accuracy can be compared alongside recorded latency without treating every
clip as equally long.

Silence, negation, and spoken self-correction examples need manual intent
checks. Their word scores can be useful diagnostics, but they should not be
used to rank candidates from a synthetic sample. Repeated clips are latency
probes rather than independent accuracy examples. Include real recordings and
review protected identifiers and intent before choosing Fast or Accurate for
daily use.

Run the unit tests with:

```sh
python3 -m unittest discover -s scripts -p 'test_*.py'
```
