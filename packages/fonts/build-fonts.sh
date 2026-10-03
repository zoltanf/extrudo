#!/bin/sh
# Builds the subsetted fonts in packages/fonts/fonts/ from the upstream
# google/fonts files (all SIL OFL 1.1). Run inside a python:3.12-slim
# container from the repo root (the exact command is in packages/fonts/README.md):
#
#   sg docker -c 'docker run --rm -v "$PWD":/w -w /w --user "$(id -u):$(id -g)" \
#     -e HOME=/tmp python:3.12-slim sh -c \
#     "pip install --quiet --user fonttools skia-pathops && PATH=/tmp/.local/bin:\$PATH sh packages/fonts/build-fonts.sh"'
#
# Steps: download the originals into .work/ (skipped when already there), pin
# the variable-font axes with varLib.instancer (which also removes overlaps
# through skia-pathops), then subset every font to the Latin ranges with
# pyftsubset. The output files are committed; a file never changes under a
# font ID (ADR-0058 §3) — a new upstream version gets new IDs (@2, …) and
# keeps the old files.
set -eu

cd "$(dirname "$0")"
WORK=.work
OUT=fonts
mkdir -p "$WORK" "$OUT"

BASE=https://raw.githubusercontent.com/google/fonts/main/ofl
UNICODES="U+0020-007E,U+00A0-017F,U+2010-2027,U+2030-203A,U+20AC,U+2122,U+2190-2193"

download() { # <file in .work/> <family dir> <file name in the family dir>
    if [ -f "$WORK/$1" ]; then return; fi
    # The brackets and comma in variable-font names are percent-encoded.
    python3 - "$BASE/$2/$3" "$WORK/$1" <<'EOF'
import sys, urllib.request
urllib.request.urlretrieve(sys.argv[1], sys.argv[2])
EOF
}

pin() { # <source file> <output file> <axis=value> …
    src="$WORK/$1"
    dst="$WORK/$1.pin"
    shift
    fonttools varLib.instancer "$src" "$@" --remove-overlaps -o "$dst"
    echo "$dst"
}

subset() { # <source file> <output file>
    # --notdef-outline keeps the .notdef box, so a character the font has no
    # glyph for still draws something (ADR-0058 §4).
    pyftsubset "$1" --unicodes="$UNICODES" \
        --layout-features="kern,liga" --no-hinting --desubroutinize --notdef-outline \
        --output-file="$OUT/$2"
}

download 'Inter.ttf' inter 'Inter[opsz,wght].ttf'
download 'NotoSerif.ttf' notoserif 'NotoSerif[wdth,wght].ttf'
download 'JetBrainsMono.ttf' jetbrainsmono 'JetBrainsMono[wght].ttf'
download 'AllertaStencil-Regular.ttf' allertastencil 'AllertaStencil-Regular.ttf'
download 'Fredoka.ttf' fredoka 'Fredoka[wdth,wght].ttf'
download 'OFL-inter.txt' inter 'OFL.txt'
download 'OFL-notoserif.txt' notoserif 'OFL.txt'
download 'OFL-jetbrainsmono.txt' jetbrainsmono 'OFL.txt'
download 'OFL-allertastencil.txt' allertastencil 'OFL.txt'
download 'OFL-fredoka.txt' fredoka 'OFL.txt'

subset "$(pin 'Inter.ttf' wght=400 opsz=14)" 'inter-regular.ttf'
subset "$(pin 'Inter.ttf' wght=700 opsz=14)" 'inter-bold.ttf'
subset "$(pin 'NotoSerif.ttf' wght=400 wdth=100)" 'noto-serif-regular.ttf'
subset "$(pin 'JetBrainsMono.ttf' wght=400)" 'jetbrains-mono-regular.ttf'
subset "$WORK/AllertaStencil-Regular.ttf" 'allerta-stencil-regular.ttf'
subset "$(pin 'Fredoka.ttf' wght=600 wdth=100)" 'fredoka-semibold.ttf'

# Report: family, upstream version (name table), size; and the pinned fonts
# must be static (no fvar left).
python3 - "$OUT"/*.ttf <<'EOF'
import sys
from fontTools.ttLib import TTFont
for name in sorted(sys.argv[1:]):
    font = TTFont(name)
    assert 'fvar' not in font, f'{name}: still a variable font'
    version = font['name'].getDebugName(5)
    print(f'{name}: {version}')
EOF
ls -l "$OUT"
