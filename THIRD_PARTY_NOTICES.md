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

## Mac FFmpeg 组件

### Apple Silicon FFmpeg：Martin Riedl 9.0.2

- 构建者网站：https://ffmpeg.martin-riedl.de/
- 固定二进制：https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip
- 维护方校验：https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip.sha256
- 同构建的版本与配置：https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/versions.txt
- FFmpeg 源码修订：https://github.com/FFmpeg/FFmpeg/commit/946fcce07b
- 构建者公开的脚本项目：https://git.martin-riedl.de/ffmpeg/build-script
- 版本配置包含 `--enable-gpl --enable-version3` 和 `--enable-libmp3lame`，没有 `--enable-nonfree`。配置原文以 `licenses/ffmpeg/README.txt` 保存，另附 `SOURCE.txt` 与完整 `COPYING.GPLv3`。本项目没有独立核实该次构建脚本的精确提交、所有补丁及完整依赖源码集合。

### Intel Mac FFmpeg：6.1.1-tessus，经 ffmpeg-static b6.1.1 分发

- 固定分发记录：https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1
- 原始构建者：https://evermeet.cx/ffmpeg/
- 分发项目的准确下载脚本：https://github.com/eugeneware/ffmpeg-static/blob/b6.1.1/download-binaries/index.sh
- FFmpeg 6.1.1 源码入口：https://github.com/FFmpeg/FFmpeg/tree/n6.1.1
- 程序中的编译版本字符串为 `6.1.1-tessus`，编译配置包含 `--enable-gpl --enable-version3`，没有 `--enable-nonfree`。这项记录来自静态二进制检查，不声称已在 Intel Mac 上实测。
- 分发项目的原始 `darwin-x64.README` 实际描述另一个 8.0 版本，按原文保留为 `licenses/ffmpeg/README.txt` 并在 `SOURCE.txt` 标明此差异。`LICENSE.md` 是原始许可摘要，`COPYING.GPLv3` 是另附的完整通用许可原文。未声称原构建者的全部补丁、构建脚本与依赖源码已被还原。

FFmpeg 作为独立可执行程序由本地子进程调用。构建来源和许可证不因本项目采用 MIT 而改变。各平台实际下载与重签名前后哈希见 `BUILD-MANIFEST.json`，进一步来源信息见 `docs/打包说明.md` 及 https://ffmpeg.org/legal.html 。本项目保留已取得的原始许可与来源材料，不把这些指引称为完整 Corresponding Source 归档。
