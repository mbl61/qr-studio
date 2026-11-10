# Third-party notices

## QR block parameter tables

The block parameter arrays in `src/tables.js` are taken from Project Nayuki's QR Code generator library, commit `bcfe1b018cec5f1f91b5705eca5bb4cdd34e9f8d`.

Source: https://github.com/nayuki/QR-Code-generator/blob/bcfe1b018cec5f1f91b5705eca5bb4cdd34e9f8d/python/qrcodegen.py

Copyright (c) Project Nayuki. (MIT License)
https://www.nayuki.io/page/qr-code-generator-library

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

- The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.
- The Software is provided "as is", without warranty of any kind, express or
  implied, including but not limited to the warranties of merchantability,
  fitness for a particular purpose and noninfringement. In no event shall the
  authors or copyright holders be liable for any claim, damages or other
  liability, whether in an action of contract, tort or otherwise, arising from,
  out of or in connection with the Software or the use or other dealings in the
  Software.

## Development-only tools

The npm lockfile records jsdom (MIT), jsQR (Apache-2.0), and their transitive
dependencies. Their license files are distributed with the installed packages.
These packages are used only for tests; `dist/` contains none of them.

Reference fixtures are generated with Project Nayuki's Python encoder. That
reference implementation is downloaded to a temporary directory only when the
fixture regeneration script is explicitly run; it is not bundled with the site.
