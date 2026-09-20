#!/usr/bin/env python3
"""Generate a deterministic third-party notice bundle from resolved local graphs.

The script intentionally reads installed package sources and cargo metadata rather
than fetching licenses. Missing text is reported in the output for follow-up.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


LICENSE_NAME = re.compile(
    r"^(?:license(?:[._ -].*)?|copying(?:[._ -].*)?|notice(?:[._ -].*)?)$",
    re.IGNORECASE,
)

OPTIONAL_PLATFORM_PACKAGE = re.compile(
    r"^(?:@esbuild/|@rollup/rollup-|@tailwindcss/oxide-|lightningcss-|"
    r"(?:sass(?:-embedded)?|less|stylus|sugarss|terser|tsx)$)"
)


_LICENSE_CACHE: dict[tuple[Path, bool], list[Path]] = {}


def license_files(directory: Path, recursive: bool = False) -> list[Path]:
    if not directory.is_dir():
        return []
    cache_key = (directory, recursive)
    if cache_key in _LICENSE_CACHE:
        return _LICENSE_CACHE[cache_key]
    candidates = directory.rglob("*") if recursive else directory.iterdir()
    files = [
        path
        for path in candidates
        if path.is_file() and LICENSE_NAME.match(path.name)
    ]
    result = sorted(files, key=lambda path: str(path.relative_to(directory)).lower())
    _LICENSE_CACHE[cache_key] = result
    return result


def cargo_license_files(directory: Path) -> list[tuple[Path, str]]:
    """Collect crate notices plus notices at a git workspace root."""
    roots = [directory]
    parent = directory.parent
    if parent.name and parent != directory:
        roots.append(parent)
    found: dict[Path, str] = {}
    for root in roots:
        for path in license_files(root, recursive=root == directory):
            # Never sweep a sibling crate when looking at a workspace root.
            if root != directory and path.parent != root:
                continue
            found[path] = str(path.relative_to(directory)) if path.is_relative_to(directory) else f"../{path.name}"
    return sorted(found.items(), key=lambda item: item[1].lower())


def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError):
        return None


def npm_packages(repo: Path) -> tuple[list[dict[str, Any]], list[str]]:
    package_json = json.loads((repo / "package.json").read_text(encoding="utf-8"))
    node_modules = repo / "node_modules"
    spdx_root = repo / "src-tauri/resources/licenses/spdx"
    spdx_urls = {
        "MIT": "https://spdx.org/licenses/MIT.html",
        "Apache-2.0": "https://spdx.org/licenses/Apache-2.0.html",
        "BSD-2-Clause": "https://spdx.org/licenses/BSD-2-Clause.html",
        "BSD-3-Clause": "https://spdx.org/licenses/BSD-3-Clause.html",
    }
    queue: list[str] = []
    for field in ("dependencies", "optionalDependencies", "peerDependencies"):
        queue.extend(package_json.get(field, {}).keys())

    seen: set[tuple[str, str]] = set()
    records: list[dict[str, Any]] = []
    missing: list[str] = []

    package_manifests: dict[str, list[Path]] = {}
    for manifest in node_modules.rglob("package.json"):
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        name = data.get("name")
        if isinstance(name, str):
            package_manifests.setdefault(name, []).append(manifest)

    while queue:
        name = queue.pop(0)
        manifests = package_manifests.get(name, [])
        if not manifests:
            if OPTIONAL_PLATFORM_PACKAGE.match(name):
                continue
            missing.append(f"npm {name}: package.json not found under node_modules")
            continue
        for manifest in manifests:
            try:
                data = json.loads(manifest.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                missing.append(f"npm {name}: could not read package.json ({error})")
                continue

            key = (data.get("name", name), data.get("version", "unknown"))
            if key in seen:
                continue
            seen.add(key)
            root = manifest.parent
            files = license_files(root)
            texts = [(str(path.relative_to(root)), read_text(path)) for path in files]
            cached_sources: list[str] = []
            if not texts:
                expression = str(data.get("license") or "").replace("/", " OR ")
                selected = next(
                    (name for name in spdx_urls if name in expression and (spdx_root / f"{name}.txt").is_file()),
                    None,
                )
                if selected:
                    texts.append((f"spdx/{selected}.txt", read_text(spdx_root / f"{selected}.txt") or ""))
                    cached_sources.append(spdx_urls[selected])
            if not files:
                if not texts:
                    missing.append(
                        f"npm {key[0]}@{key[1]}: no license/notice file found (declared {data.get('license') or data.get('licenses') or 'unknown'})"
                    )
                else:
                    missing.append(
                        f"npm {key[0]}@{key[1]}: package-specific copyright notice unavailable; SPDX text supplied (declared {data.get('license') or data.get('licenses') or 'unknown'})"
                    )
            for filename, text in texts:
                if text is None:
                    missing.append(f"npm {key[0]}@{key[1]}: {filename} could not be read")
            records.append(
                {
                    "kind": "npm",
                    "name": key[0],
                    "version": key[1],
                    "license": data.get("license") or data.get("licenses") or "unknown",
                    "repository": data.get("repository"),
                    "files": texts,
                    "license_sources": cached_sources,
                }
            )
            for field in ("dependencies", "optionalDependencies", "peerDependencies"):
                queue.extend(data.get(field, {}).keys())

    return records, missing


def cargo_packages(metadata_path: Path) -> tuple[list[dict[str, Any]], list[str]]:
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    cache_path = Path(__file__).resolve().parents[1] / "src-tauri/resources/licenses/license-sources.json"
    license_cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.is_file() else {}
    spdx_root = cache_path.parent / "spdx"
    spdx_urls = {
        "MIT": "https://spdx.org/licenses/MIT.html",
        "Apache-2.0": "https://spdx.org/licenses/Apache-2.0.html",
        "BSD-2-Clause": "https://spdx.org/licenses/BSD-2-Clause.html",
        "BSD-3-Clause": "https://spdx.org/licenses/BSD-3-Clause.html",
        "MPL-2.0": "https://spdx.org/licenses/MPL-2.0.html",
        "Zlib": "https://spdx.org/licenses/Zlib.html",
        "LGPL-2.1-or-later": "https://spdx.org/licenses/LGPL-2.1-or-later.html",
    }
    packages = {package["id"]: package for package in metadata["packages"]}
    nodes = {node["id"]: node for node in metadata["resolve"]["nodes"]}
    root = metadata["resolve"]["root"]

    queue = list(nodes[root]["dependencies"])
    seen: set[str] = set()
    records: list[dict[str, Any]] = []
    missing: list[str] = []

    def macos_dependencies(node: dict[str, Any]) -> list[str]:
        selected = []
        for dependency in node.get("deps", []):
            targets = [entry.get("target") for entry in dependency.get("dep_kinds", [])]
            if any(
                target is None
                or any(token in target for token in ("macos", "apple", "unix"))
                for target in targets
            ):
                selected.append(dependency["pkg"])
        return selected

    queue = macos_dependencies(nodes[root])
    while queue:
        package_id = queue.pop(0)
        if package_id in seen:
            continue
        seen.add(package_id)
        package = packages.get(package_id)
        node = nodes.get(package_id)
        if not package or not node:
            missing.append(f"cargo {package_id}: package missing from metadata")
            continue
        manifest = Path(package["manifest_path"])
        file_entries = cargo_license_files(manifest.parent)
        texts = [(relative, read_text(path)) for path, relative in file_entries]
        cached = license_cache.get(package_id, {})
        cached_sources = []
        for cached_file in cached.get("files", []):
            cached_name = f"cached/{cached_file['name']}"
            texts.append((cached_name, cached_file.get("text", "")))
            if cached_file.get("url"):
                cached_sources.append(cached_file["url"])
        if not texts:
            expression = (package.get("license") or "").replace("/", " OR ")
            selected = next(
                (name for name in spdx_urls if name in expression and (spdx_root / f"{name}.txt").is_file()),
                None,
            )
            if selected:
                texts.append((f"spdx/{selected}.txt", read_text(spdx_root / f"{selected}.txt") or ""))
                cached_sources.append(spdx_urls[selected])
        if not file_entries:
            if not texts:
                missing.append(
                    f"cargo {package['name']}@{package['version']}: no license/notice file found (declared {package.get('license') or 'unknown'})"
                )
            elif not file_entries and not cached.get("files"):
                missing.append(
                    f"cargo {package['name']}@{package['version']}: package-specific copyright notice unavailable; SPDX text supplied (declared {package.get('license') or 'unknown'})"
                )
        for filename, text in texts:
            if text is None:
                missing.append(
                    f"cargo {package['name']}@{package['version']}: {filename} could not be read"
                )
        records.append(
            {
                "kind": "cargo",
                "name": package["name"],
                "version": package["version"],
                "license": package.get("license") or "unknown",
                "repository": package.get("repository"),
                    "source": package.get("source"),
                    "authors": package.get("authors", []),
                    "files": texts,
                "license_sources": sorted(set(cached_sources)),
            }
        )
        queue.extend(macos_dependencies(node))

    return records, missing


def format_repository(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return str(value.get("url") or value.get("directory") or "")
    return ""


def render(records: list[dict[str, Any]], missing: list[str]) -> str:
    records.sort(key=lambda record: (record["kind"], record["name"].lower(), record["version"]))
    lines = [
        "# Dictation third-party notices",
        "",
        "Generated by scripts/generate_notices.py from the resolved local npm and Cargo graphs.",
        "This file includes runtime dependency closure plus build dependencies reported by Cargo.",
        "License text is copied from each resolved package source when available.",
        "",
        f"Packages listed: {len(records)}",
        "",
    ]
    for record in records:
        lines.extend(
            [
                "=" * 78,
                f"{record['kind'].upper()}: {record['name']} {record['version']}",
                f"License: {record['license']}",
            ]
        )
        repository = format_repository(record.get("repository"))
        if repository:
            lines.append(f"Source: {repository}")
        if record.get("source"):
            lines.append(f"Package source: {record['source']}")
        if record.get("authors"):
            lines.append(f"Cargo authors (upstream metadata): {', '.join(record['authors'])}")
        for source in record.get("license_sources", []):
            lines.append(f"License source: {source}")
        files = record["files"]
        if not files:
            lines.extend(["", "[NOTICE TEXT NOT FOUND IN LOCAL PACKAGE SOURCE]"])
        else:
            for filename, text in files:
                lines.extend(["", f"--- {filename} ---", text or "[NOTICE FILE COULD NOT BE READ]"])
        lines.append("")

    lines.extend(
        [
            "=" * 78,
            "BUNDLED PROJECT ASSETS",
            "",
            "Silero VAD model (src-tauri/resources/models/silero_vad_v4.onnx)",
            "The model is distributed by the Silero VAD project under the MIT License.",
            "Source: https://github.com/snakers4/silero-vad",
            "Copyright (c) 2020-present Silero Team",
            "The full MIT text is reproduced below:",
            "",
            "MIT License",
            "",
            "Copyright (c) 2020-present Silero Team",
            "",
            "Permission is hereby granted, free of charge, to any person obtaining a copy",
            "of this software and associated documentation files (the \"Software\"), to deal",
            "in the Software without restriction, including without limitation the rights",
            "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
            "copies of the Software, and to permit persons to whom the Software is",
            "furnished to do so, subject to the following conditions:",
            "",
            "The above copyright notice and this permission notice shall be included in all",
            "copies or substantial portions of the Software.",
            "",
            "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR",
            "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
            "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
            "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
            "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
            "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
            "SOFTWARE.",
            "",
            "Dictation waveform mark (assets/dictation.svg)",
            "Created for Dictation and distributed under the repository MIT License.",
            "",
            "Notification sounds (src-tauri/resources/*.wav)",
            "No separate upstream sound source was identified in the checkout. These",
            "inherited Handy assets are distributed under the repository root MIT notice;",
            "retain that notice with releases. Their historical source remains an",
            "upstream-provenance follow-up rather than a separate license claim.",
            "",
            "MPL-2.0 source availability",
            "The resolved Cargo graph includes MPL-2.0 packages whose registry archives",
            "omit license text. Their source repositories are recorded here for source",
            "availability and follow-up notice retrieval:",
            "- https://www.mozilla.org/en-US/MPL/2.0/",
            "- https://github.com/servo/servo",
            "- https://github.com/servo/stylo",
            "- https://github.com/pdeljanov/Symphonia",
            "",
        ]
    )

    lines.extend(
        [
            "=" * 78,
            "UNRESOLVED ITEMS",
            "The following packages or notice files need manual review before claiming exhaustive coverage:",
        ]
    )
    if missing:
        lines.extend(f"- {item}" for item in sorted(set(missing)))
    else:
        lines.append("- None found by the local graph/package-source scan.")
    lines.extend(
        [
            "",
            "This generated bundle does not cover downloaded speech models or non-package artwork/sounds.",
            "Review src-tauri/src/catalog/catalog.json and bundled resources separately.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--metadata", type=Path, default=Path("/tmp/dictation-metadata.json"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("src-tauri/resources/licenses/THIRD-PARTY-NOTICES.txt"),
    )
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    npm, npm_missing = npm_packages(repo)
    cargo, cargo_missing = cargo_packages(args.metadata)
    output = render(npm + cargo, npm_missing + cargo_missing)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(output, encoding="utf-8")
    print(f"wrote {args.output} ({len(npm)} npm, {len(cargo)} Cargo packages)")
    if npm_missing or cargo_missing:
        print(f"unresolved items: {len(npm_missing) + len(cargo_missing)}")


if __name__ == "__main__":
    main()
