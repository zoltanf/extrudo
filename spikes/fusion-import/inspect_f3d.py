"""List what is inside a Fusion .f3d/.f3z archive, without extracting or executing anything.

Usage: python3 -I inspect_f3d.py <file> [--nested] [--peek NAME] [--strings NAME [--utf16] [--all]]

Treats the file as untrusted data: reads entries in memory, prints names,
sizes, the first bytes and whether an entry looks like text.
"""

import io
import re
import sys
import zipfile

# Fusion files saved in 2026 store most entries as ZIP method 93 (Zstandard);
# Python 3.14's zipfile reads it, older ones raise NotImplementedError.


def read(z: zipfile.ZipFile, info: zipfile.ZipInfo) -> bytes:
    return z.read(info)


def kind(data: bytes) -> str:
    if not data:
        return "empty"
    sample = data[:4096]
    printable = sum(1 for b in sample if 32 <= b < 127 or b in (9, 10, 13))
    return "text" if printable / len(sample) > 0.95 else "binary"


def show(z: zipfile.ZipFile, indent: str, nested: bool) -> None:
    for info in z.infolist():
        data = read(z, info) if info.file_size < 200_000_000 else b""
        head = data[:16]
        print(
            f"{indent}m{info.compress_type:<3}{info.file_size:>10} {info.compress_size:>10} {kind(data):6} "
            f"{head.hex()[:32]:32} {head[:16]!r:24} {info.filename}"
        )
        if nested and zipfile.is_zipfile(io.BytesIO(data)):
            show(zipfile.ZipFile(io.BytesIO(data)), indent + "    ", nested)


def find(z: zipfile.ZipFile, name: str) -> bytes:
    for info in z.infolist():
        if info.filename.endswith(name):
            return read(z, info)
        data = read(z, info)
        if zipfile.is_zipfile(io.BytesIO(data)):
            try:
                return find(zipfile.ZipFile(io.BytesIO(data)), name)
            except KeyError:
                pass
    raise KeyError(name)


def main() -> None:
    path = sys.argv[1]
    z = zipfile.ZipFile(path)
    if "--peek" in sys.argv:
        data = find(z, sys.argv[sys.argv.index("--peek") + 1])
        print(data[:1500].decode("latin-1"))
        return
    if "--strings" in sys.argv:
        data = find(z, sys.argv[sys.argv.index("--strings") + 1])
        if "--utf16" in sys.argv:
            words = [m.replace(b"\x00", b"") for m in re.findall(rb"(?:[ -~]\x00){4,}", data)]
        else:
            words = re.findall(rb"[A-Za-z_][A-Za-z0-9_\-:. ]{5,}", data)
        seen = {}
        for w in words:
            seen[w] = seen.get(w, 0) + 1
        for w, n in sorted(seen.items(), key=lambda kv: -kv[1])[: (None if "--all" in sys.argv else 120)]:
            print(n, w.decode("latin-1"))
        return
    show(z, "", "--nested" in sys.argv)


main()
