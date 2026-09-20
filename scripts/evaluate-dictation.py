#!/usr/bin/env python3
"""Evaluate named transcribe.cpp models against a JSON audio/reference manifest.

The harness intentionally has no third-party dependencies.  It runs one batch
per candidate so each candidate can have its own model and optional backend.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Iterable


WORD_RE = re.compile(r"[^\W_]+(?:['’][^\W_]+)*", re.UNICODE)
IDENTIFIER_CHAR_RE = r"A-Za-z0-9_/"


def tokenize(text: str) -> list[str]:
    """Return case-folded word tokens while retaining identifier spelling."""
    return [match.group(0).casefold() for match in WORD_RE.finditer(text)]


def word_error_counts(reference: str, hypothesis: str) -> dict[str, int]:
    """Compute Levenshtein substitutions, deletions, and insertions by word."""
    ref = tokenize(reference)
    hyp = tokenize(hypothesis)
    # Each cell is (cost, substitutions, deletions, insertions). Keeping all
    # counters in the DP state avoids inferring counts from the final cost.
    previous = [(j, 0, 0, j) for j in range(len(hyp) + 1)]
    for i, ref_word in enumerate(ref, 1):
        current = [(i, 0, i, 0)] + [(0, 0, 0, 0)] * len(hyp)
        for j, hyp_word in enumerate(hyp, 1):
            deletion = (previous[j][0] + 1, previous[j][1], previous[j][2] + 1, previous[j][3])
            insertion = (current[j - 1][0] + 1, current[j - 1][1], current[j - 1][2], current[j - 1][3] + 1)
            substitution = (
                previous[j - 1][0] + (ref_word != hyp_word),
                previous[j - 1][1] + (ref_word != hyp_word),
                previous[j - 1][2],
                previous[j - 1][3],
            )
            # Stable tie order: substitution/match, deletion, insertion.
            current[j] = min((substitution, deletion, insertion), key=lambda state: state[0])
        previous = current
    distance, substitutions, deletions, insertions = previous[-1]
    return {
        "reference_words": len(ref),
        "hypothesis_words": len(hyp),
        "substitutions": substitutions,
        "deletions": deletions,
        "insertions": insertions,
        "errors": distance,
    }


def normalized_wer(reference: str, hypothesis: str) -> dict[str, Any]:
    counts = word_error_counts(reference, hypothesis)
    denominator = counts["reference_words"]
    counts["wer"] = counts["errors"] / denominator if denominator else (0.0 if not counts["hypothesis_words"] else 1.0)
    return counts


def protected_term_recall(transcript: str, protected_terms: Iterable[str]) -> dict[str, Any]:
    """Match literal, case-sensitive terms without identifier substrings."""
    terms = [str(term) for term in protected_terms if str(term)]
    found: list[str] = []
    missing: list[str] = []
    for term in terms:
        # Spaces in a phrase may vary, while identifier punctuation and case
        # remain exact. Identifier boundaries include underscores and slashes.
        literal = re.escape(term).replace("\\ ", r"\s+")
        pattern = rf"(?<![{IDENTIFIER_CHAR_RE}]){literal}(?![{IDENTIFIER_CHAR_RE}])"
        present = re.search(pattern, transcript) is not None
        (found if present else missing).append(term)
    return {
        "total": len(terms),
        "found": len(found),
        "recall": len(found) / len(terms) if terms else None,
        "found_terms": found,
        "missing_terms": missing,
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _load_manifest(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        inputs, candidates = data, []
    else:
        inputs, candidates = data.get("inputs", data.get("audio", [])), data.get("candidates", [])
    if not inputs or not candidates:
        raise ValueError("manifest must contain non-empty 'inputs' and 'candidates'")
    base = path.parent
    for item in inputs:
        if "path" not in item or "reference" not in item:
            raise ValueError("each input needs path and reference")
        item["path"] = str((base / item["path"]).resolve()) if not Path(item["path"]).is_absolute() else str(Path(item["path"]).resolve())
        item.setdefault("protected_terms", [])
    for candidate in candidates:
        if not candidate.get("name") or not (candidate.get("model") or candidate.get("model_path")):
            raise ValueError("each candidate needs name and model")
        model_path = candidate.get("model") or candidate["model_path"]
        candidate["model"] = str((base / model_path).resolve()) if not Path(model_path).is_absolute() else str(Path(model_path).resolve())
    return inputs, candidates


def _is_whisper(candidate: dict[str, Any]) -> bool:
    family = str(candidate.get("family", "")).casefold()
    return family == "whisper" or "whisper" in Path(candidate["model"]).stem.casefold() or "whisper" in str(candidate["name"]).casefold()


def _prompt_for(candidate: dict[str, Any], inputs: list[dict[str, Any]]) -> str | None:
    if not candidate.get("use_vocabulary", False) or not _is_whisper(candidate):
        return None
    terms = []
    for item in inputs:
        for term in item.get("protected_terms", []):
            if term not in terms:
                terms.append(term)
    return candidate.get("initial_prompt") or ("Technical vocabulary: " + ", ".join(terms) + "." if terms else None)


def evaluate(manifest_path: Path, cli: Path, backend: str | None = None, threads: int | None = None) -> dict[str, Any]:
    inputs, candidates = _load_manifest(manifest_path)
    if not cli.is_file():
        raise FileNotFoundError(f"transcribe CLI not found: {cli}")
    output: dict[str, Any] = {
        "schema_version": 1,
        "manifest": str(manifest_path.resolve()),
        "cli": {"path": str(cli.resolve()), "sha256": sha256_file(cli)},
        "runtime_hashes": {"transcribe_cli_sha256": sha256_file(cli)},
        "candidates": [],
    }
    for candidate in candidates:
        model = Path(candidate["model"])
        if not model.is_file():
            raise FileNotFoundError(f"model not found for {candidate['name']}: {model}")
        batch = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", encoding="utf-8", delete=False)
        try:
            batch.write("\n".join(item["path"] for item in inputs) + "\n")
            batch.close()
            command = [str(cli), "--model", str(model), "--batch", batch.name, "--batch-jsonl"]
            if backend:
                command += ["--backend", backend]
            if threads:
                command += ["--threads", str(threads)]
            prompt = _prompt_for(candidate, inputs)
            if prompt:
                command += ["--initial-prompt", prompt]
            started = time.perf_counter()
            stderr_log = tempfile.NamedTemporaryFile(mode="w+", suffix=".stderr", encoding="utf-8", delete=False)
            stderr_log.close()
            stderr_handle = open(stderr_log.name, "w", encoding="utf-8")
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=stderr_handle, text=True)
            rows: list[dict[str, Any]] = []
            header: dict[str, Any] | None = None
            assert process.stdout is not None
            previous = started
            cold_start_wall_ms: float | None = None
            for line in process.stdout:
                now = time.perf_counter()
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get("type") == "batch_header":
                    header = row
                    cold_start_wall_ms = (now - started) * 1000
                    previous = now
                    continue
                if "file" not in row:
                    continue
                index = next((i for i, item in enumerate(inputs) if str(Path(item["path"]).resolve()) == str(Path(row["file"]).resolve())), None)
                if index is None:
                    continue
                if cold_start_wall_ms is None:
                    cold_start_wall_ms = (now - started) * 1000
                transcript = str(row.get("text", row.get("raw_text", "")))
                engine = {key: row[key] for key in ("mel_ms", "encode_ms", "decode_ms") if key in row}
                engine["total_ms"] = sum(value for key, value in engine.items() if key != "total_ms" and isinstance(value, (int, float)))
                result = {
                    "input": inputs[index]["path"],
                    "reference": inputs[index]["reference"],
                    "protected_terms": inputs[index].get("protected_terms", []),
                    "raw_transcript": transcript,
                    "wall_ms": (now - previous) * 1000,
                    "engine_ms": engine,
                    "wer": normalized_wer(inputs[index]["reference"], transcript),
                    "protected_term_recall": protected_term_recall(transcript, inputs[index].get("protected_terms", [])),
                }
                rows.append(result)
                previous = now
            returncode = process.wait()
            total_wall_ms = (time.perf_counter() - started) * 1000
            stderr_handle.close()
            stderr = Path(stderr_log.name).read_text(encoding="utf-8", errors="replace")
            Path(stderr_log.name).unlink(missing_ok=True)
            if returncode:
                raise RuntimeError(f"{candidate['name']} failed with exit code {returncode}: {stderr[-2000:]}")
            if len(rows) != len(inputs):
                raise RuntimeError(f"{candidate['name']} returned {len(rows)} results for {len(inputs)} inputs")
            total_reference_words = sum(row["wer"]["reference_words"] for row in rows)
            total_errors = sum(row["wer"]["errors"] for row in rows)
            total_terms = sum(row["protected_term_recall"]["total"] for row in rows)
            total_found_terms = sum(row["protected_term_recall"]["found"] for row in rows)
            output["candidates"].append({
                "name": candidate["name"],
                "model": str(model),
                "model_sha256": sha256_file(model),
                "backend": backend,
                "initial_prompt": prompt,
                "command": command,
                "header": header,
                "cold_start_wall_ms": cold_start_wall_ms,
                "engine_load_ms": header.get("load_ms") if header else None,
                "total_wall_ms": total_wall_ms,
                "summary": {
                    "weighted_wer": total_errors / total_reference_words if total_reference_words else None,
                    "protected_term_recall": total_found_terms / total_terms if total_terms else None,
                    "reference_words": total_reference_words,
                    "protected_terms": total_terms,
                },
                "results": rows,
            })
        finally:
            Path(batch.name).unlink(missing_ok=True)
    return output


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--cli", required=True, type=Path, help="transcribe.cpp transcribe-cli executable")
    parser.add_argument("--output", type=Path, help="write JSON here (stdout by default)")
    parser.add_argument("--backend")
    parser.add_argument("--threads", type=int)
    args = parser.parse_args(argv)
    try:
        result = evaluate(args.manifest, args.cli, args.backend, args.threads)
    except (OSError, ValueError, RuntimeError) as error:
        print(f"evaluate-dictation: {error}", file=sys.stderr)
        return 2
    rendered = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
