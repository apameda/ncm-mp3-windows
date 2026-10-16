# NCM 批量转 MP3 v1.0.0

适用于 **Windows 10/11 64 位（x64）**。

## 下载与使用

下载下方的 **NCM批量转MP3-Windows-x64.zip**，完整解压后双击 `NCM批量转MP3.exe`。

无需安装 Python、Node.js 或 FFmpeg；请保留文件夹内的所有文件，不要只复制 EXE，也不要在压缩包中直接运行。

## 功能

- 批量添加 NCM 文件，或递归添加整个文件夹，支持拖放和自动去重。
- 选择输出位置，查看逐首进度、失败原因，支持取消和重试。
- FLAC 转码支持 320 / 256 / 192 kbps，输出为 44.1 kHz MP3，默认 320 kbps。
- 内层已经是 MP3 时直接还原音频流，保留原有码率与采样率，避免二次压缩。
- 保留可读取的歌名、歌手和专辑信息；此版本不写入封面。
- 本地离线处理，保留原始 NCM；同名成品自动另存，不覆盖已有文件。
- 每首歌都在完整解码检查通过后保存成品。

## 验证状态

42 项自动测试通过，包含真实短音频转换和批量控制流程；界面使用模拟接口检查。

本版本在 macOS 上制作，**尚未完成 Windows 实机验收**，未进行应用专用的代码签名和信誉验证。损坏或非标准 NCM 文件可能无法转换。

## 源码与第三方软件

应用源码使用 MIT 许可。随包 Electron、Chromium 和 FFmpeg 保留各自许可，具体见包内 `THIRD_PARTY_NOTICES.md`、`LICENSE-electron`、`LICENSES.chromium.html` 与 `licenses/ffmpeg/`。

**FFmpeg 对应源码获取指引：**见本仓库 `docs/第三方源码.md` 及绿色版根目录 `第三方源码.md`。精确版本、上游下载链接与 SHA-256 记录在包内 `BUILD-MANIFEST.json`。

下载旁附有 Windows ZIP 的 `.sha256` 校验文件和完整项目源码 ZIP。
