# Third-party notices

## ncmdump — NCM container algorithm

The NCM container parsing, AES constants and key-box transform in `src/ncm.js`
are adapted from the MIT-licensed taurusxin/ncmdump project. This implementation
uses Node.js crypto and file APIs; it does not bundle ncmdump's C++ binary,
TagLib, cJSON, or AES implementation.

- Project: https://github.com/taurusxin/ncmdump
- Source: https://github.com/taurusxin/ncmdump/blob/main/src/ncmcrypt.cpp
- License: https://github.com/taurusxin/ncmdump/blob/main/LICENSE.txt

The upstream license is reproduced below verbatim, including its placeholder
copyright line:

```text
MIT License

Copyright (c) [year] [fullname]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Electron 44.7.2

Windows runtime: https://github.com/electron/electron/releases/tag/v44.7.2

Electron is distributed under the MIT license. The runtime's full original
license is included as `LICENSE-electron` in the portable ZIP. The Chromium and
other runtime component notices are included as `LICENSES.chromium.html`.
Runtime source code: https://github.com/electron/electron/tree/v44.7.2

## FFmpeg 9.0.2 Windows essentials build (Gyan)

The app invokes the separate, unmodified FFmpeg executable as a local subprocess.
This executable is supplied by Gyan Doshi and is licensed under GPLv3. Its
original `LICENSE` and `README.txt` (including configuration and dependency
details) are included under `licenses/ffmpeg/` in the portable ZIP. The app does
not bundle ffprobe or ffplay.

- Maintainer and build information: https://www.gyan.dev/ffmpeg/builds/
- Exact binary release: https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2
- Exact FFmpeg source revision: https://github.com/FFmpeg/FFmpeg/commit/946fcce07b
- FFmpeg source archive at that revision: https://github.com/FFmpeg/FFmpeg/archive/946fcce07b.tar.gz
- Source repository: https://github.com/FFmpeg/FFmpeg
- LAME source: https://sourceforge.net/projects/lame/files/lame/3.100/
- FFmpeg license information: https://ffmpeg.org/legal.html

The original upstream build README is preserved byte-for-byte at
`licenses/ffmpeg/README.txt` in the portable ZIP. It lists build configuration
and external-library version strings. The source guide is `docs/第三方源码.md`
in the complete source project and is also included as `第三方源码.md` in the
portable ZIP root and `resources/app/`. It records the declared dependency
versions, official project entry points, and items not independently verified.
The exact upstream build scripts, complete dependency source trees, patches,
and toolchain inputs have not all been located or reconstructed. This project
does not represent that the guide is a complete Corresponding Source archive.

The project's own JavaScript, HTML and CSS are MIT licensed; third-party
components retain their own licenses. `BUILD-MANIFEST.json` records the exact
upstream downloads and SHA-256 checksums used in each build.
