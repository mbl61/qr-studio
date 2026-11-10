# QR Studio

A QR Code Model 2 generator and encoding explorer built with plain HTML, CSS, and JavaScript. Create a code, download a crisp PNG or SVG, and inspect the bits, correction blocks, and mask scores that produced it.

All encoding runs on the device. The application sends no message data to a server, uses no analytics or browser storage, and loads no third-party runtime assets. The hosting provider still receives normal requests for the static site files. The site needs JavaScript and a modern browser with ES modules, `TextEncoder`, SVG, and Canvas support. A module worker keeps encoding off the main thread where available, with a local fallback.

## Run locally

Install Node.js 20 or newer, then run these commands from this directory:

```sh
npm start
```

Open **http://127.0.0.1:4173**. No dependency installation is needed to run the application. Use an HTTP server rather than opening `index.html` with a `file://` URL, because browser module loading requires HTTP(S). To change the port, set the `PORT` environment variable.

For development checks:

```sh
npm ci
npm test
npm run build
```

`npm run build` copies the static site into `dist/`; it does not compile or bundle the JavaScript. Test dependencies are never shipped to visitors.

## Use the generator

- Enter text or a full URL. Leading zeros, spaces, line breaks, and letter case are preserved. A URL is encoded as text; the scanner decides whether to open it.
- Choose correction level **L, M, Q, or H**. Higher redundancy may require a larger grid. The selected level is used exactly, without automatic boosting.
- Open **Advanced settings** to select the encoding mode, a fixed version, or a fixed mask.
- Choose an integer export scale and download **PNG** for raster use or **SVG** for scalable artwork. Both contain black modules on white with a four-module quiet zone. Keep the border intact and avoid stretching or lossy compression.
- Open **Explore this code's encoding** to inspect padding, block correction bytes, interleaving, all eight masks, and penalty totals.

Blank input clears the preview. A message that cannot fit, or that is invalid for the selected mode, produces an error and disables downloads. Input is limited to 10,000 UTF-16 code units in the UI; actual QR capacity is lower and depends on encoding and correction level.

## Encoding profile

The encoder in `src/qr.js` implements the construction pipeline directly:

1. Encode one data segment with a mode and version-dependent count field.
2. Select the smallest fitting version, or validate an explicitly requested version.
3. Append the terminator, byte-alignment zeros, and alternating `EC` / `11` pad words.
4. Partition contiguous data into short and long blocks. Compute Reed–Solomon remainders in GF(256), using reduction polynomial `0x11D` and generator roots starting at alpha^0.
5. Interleave data words, then correction words, and append zero remainder bits.
6. Draw and reserve finder, separator, timing, alignment, format, version, and fixed dark modules. Place the bit stream in alternating two-column stripes.
7. Apply each mask to the original encoding region, write its BCH-protected metadata, and score the complete symbol. Choose the smallest total, breaking ties with the lowest mask number.
8. Render the selected matrix with a quiet zone.

Supported features:

| Feature | Behavior |
| --- | --- |
| Versions | 1–40, including version 32 alignment spacing |
| Correction | L / M / Q / H, exact selection |
| Byte text | ASCII directly; non-ASCII as UTF-8 with ECI assignment 26 |
| Numeric | Digits 0–9, three at a time |
| Alphanumeric | `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:` |
| Automatic mode | One numeric segment if possible, otherwise alphanumeric, otherwise byte |
| Raw bytes | `encodeBytes(Uint8Array)` in the JavaScript API, without ECI |
| Masks | Automatic selection or a fixed mask 0–7; all candidates remain inspectable |
| Penalties | N1–N4; run-based 1:1:3:1:1 finder test with virtual light borders |

Automatic mode does not optimize mixed-mode segmentation. Kanji mode, structured append, FNC1/GS1, Micro QR, rectangular Micro QR, arbitrary ECI assignments, and decoding are outside this implementation's scope.

Coordinates use `matrix[y][x]`, with `(0,0)` at the upper left; `1` is dark. Each row is a `Uint8Array`. Data words are read most significant bit first; metadata placement indexes from the least significant bit. `functions[y][x]` identifies reserved areas: 0 encoding, 1 finder, 2 separator, 3 timing, 4 alignment, 5 format, 6 version, 7 fixed dark.

## JavaScript API

```js
import { encodeText, encodeBytes } from './src/qr.js';
import { toSvg, paintCanvas } from './src/render.js';

const qr = encodeText('HELLO', {
  level: 'M',       // L, M, Q, H; default M
  mode: 'byte',     // byte, numeric, alphanumeric, auto; default byte
  version: 'auto', // auto, or an integer 1–40
  mask: 'auto',    // auto, or an integer 0–7
});

const svg = toSvg(qr.matrix, { scale: 20 });
// In a browser:
paintCanvas(document.querySelector('canvas'), qr.matrix, { scale: 20 });

const binaryQr = encodeBytes(new Uint8Array([0, 128, 255]), { level: 'Q' });
```

The result includes `matrix`, `version`, `size`, `mask`, `bestMask`, `level`, `mode`, `eci`, `capacity`, padded `data`, `blocks`, `interleaved`, and all eight `candidates` with their matrices and component scores. Invalid inputs throw `TypeError` or `RangeError`. `encodeText` rejects isolated UTF-16 surrogates rather than silently changing the content. The low-level API accepts empty payloads, although the UI treats empty input as a cleared state.

## Verification

Run `npm test` for:

- Matrix hashes and mask penalty totals checked against Project Nayuki's independent Python encoder for **all 160 version/level combinations and all eight masks (1,280 matrices)**, using deterministic binary payloads near capacity.
- 21 independent text fixtures, including Unicode/ECI, null bytes, spaces, count-field transitions, maximum numeric/alphanumeric/byte payloads, and version 32.
- Exact `HELLO` padding, Reed–Solomon bytes, all eight component scores, and format word. Byte-mode `HELLO` at level M produces version 1, mask 4, and format word `0x45F9`.
- Zero-remainder checks for protected blocks, reserved-cell invariants, invalid options, over-capacity messages, and a shortened terminator.
- Independent jsQR decoding of rasterized exports and SVG path output.
- DOM integration checks for examples, settings, validation, clear, inspection, SVG download dispatch, worker fallback, and stale-result handling.

The fixtures are pinned to Project Nayuki commit `bcfe1b018cec5f1f91b5705eca5bb4cdd34e9f8d`. To regenerate them, run `python scripts/generate-fixtures.py` with Python 3.9+ and internet access. Normal tests use checked-in fixtures and do not access the network.

DOM tests simulate browser behavior; they do not verify visual layout, actual browser download handling, or physical scanning quality. Before release, review the responsive layout in a browser, download both formats, and scan the output on the intended devices and printed materials.
