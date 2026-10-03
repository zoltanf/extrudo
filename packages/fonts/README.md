# @extrudo/fonts

The fonts bundled for sketch text (ADR-0058 §3): static TTFs, subsetted to the
Latin ranges, all under the SIL Open Font License 1.1 (one `OFL-<family>.txt`
per family). `src/index.ts` is the manifest the app and tests read.

| ID | Family | Style | Source (github.com/google/fonts) | Upstream version | Size |
|---|---|---|---|---|---|
| `inter-regular@1` | Inter | Regular | [ofl/inter](https://github.com/google/fonts/tree/main/ofl/inter) (variable `Inter[opsz,wght].ttf`, pinned `wght=400 opsz=14`) | 4.001;git-66647c0bb | 44,344 B |
| `inter-bold@1` | Inter | Bold | [ofl/inter](https://github.com/google/fonts/tree/main/ofl/inter) (variable `Inter[opsz,wght].ttf`, pinned `wght=700 opsz=14`) | 4.001;git-66647c0bb | 44,508 B |
| `noto-serif-regular@1` | Noto Serif | Regular | [ofl/notoserif](https://github.com/google/fonts/tree/main/ofl/notoserif) (variable `NotoSerif[wdth,wght].ttf`, pinned `wght=400 wdth=100`) | 2.015 | 36,968 B |
| `jetbrains-mono-regular@1` | JetBrains Mono | Regular | [ofl/jetbrainsmono](https://github.com/google/fonts/tree/main/ofl/jetbrainsmono) (variable `JetBrainsMono[wght].ttf`, pinned `wght=400`) | 2.211 | 24,548 B |
| `allerta-stencil-regular@1` | Allerta Stencil | Regular | [ofl/allertastencil](https://github.com/google/fonts/tree/main/ofl/allertastencil) (static `AllertaStencil-Regular.ttf`) | 1.02 | 14,940 B |
| `fredoka-semibold@1` | Fredoka | SemiBold | [ofl/fredoka](https://github.com/google/fonts/tree/main/ofl/fredoka) (variable `Fredoka[wdth,wght].ttf`, pinned `wght=600 wdth=100`) | 2.001 | 35,216 B |

**A file never changes under an ID** (ADR-0058 §3): a saved design keeps its
exact shape. A newer upstream version, a different subset or any other change
gets new IDs (`@2`, …) and new files; the old ones stay.

## Rebuilding the fonts

The files in `fonts/` are committed and the recipe is `build-fonts.sh`: it
downloads the upstream files into `.work/` (gitignored), pins the variable
axes with `fonttools varLib.instancer` (which also removes overlaps through
skia-pathops) and subsets each font with `pyftsubset` to
`U+0020-007E, U+00A0-017F, U+2010-2027, U+2030-203A, U+20AC, U+2122,
U+2190-2193`, keeping the `kern` and `liga` layout features, without hinting,
with the `.notdef` outline kept (`--notdef-outline`: a character the font has
no glyph for draws the tofu box).

fontTools runs in a container so that no Python setup is needed on the host.
From the repo root:

```sh
sg docker -c 'docker run --rm -v "$PWD":/w -w /w --user "$(id -u):$(id -g)" \
  -e HOME=/tmp python:3.12-slim sh -c \
  "pip install --quiet --user fonttools skia-pathops && PATH=/tmp/.local/bin:\$PATH sh packages/fonts/build-fonts.sh"'
```

(Use plain `docker run …` instead of `sg docker -c '…'` where the user is
already in the `docker` group.) The script is idempotent: re-running it
re-derives `fonts/` from the same upstream inputs. Do **not** commit `.work/`.

Subsetting a font by hand, outside the script:

```sh
pyftsubset font.ttf \
  --unicodes="U+0020-007E,U+00A0-017F,U+2010-2027,U+2030-203A,U+20AC,U+2122,U+2190-2193" \
  --layout-features="kern,liga" --no-hinting --desubroutinize --notdef-outline \
  --output-file=subset.ttf
```

## Adding a font

Pick an SIL-OFL-licensed family from google/fonts, add its download, pin and
subset lines to `build-fonts.sh`, its `OFL-<family>.txt`, a row above, an
entry in `src/index.ts` and the family's copyright line to the repository's
`NOTICE` (§2). Keep each subset file under about 120 kB.
