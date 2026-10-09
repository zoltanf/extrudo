# Fusion import research probe

`inspect_f3d.py` lists what is inside a Fusion `.f3d`/`.f3z` archive for
`docs/research/fusion-import.md`. It reads entries in memory and never extracts
or executes anything. Run it with `python3 -I` (3.14+ for files saved in 2026,
whose entries are ZIP method 93, Zstandard) on a sample kept in its own scratch
directory; no sample files are committed.

```sh
python3 -I inspect_f3d.py <file> [--nested]          # entries, sizes, magic bytes
python3 -I inspect_f3d.py <file> --peek <entry>      # first bytes of an entry
python3 -I inspect_f3d.py <file> --strings <entry> [--utf16] [--all]
```
