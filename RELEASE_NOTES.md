# NCM 批量转 MP3 v1.0.0

适用于 **Windows 10/11 x64**，以及 **macOS 13+ 的 Apple 芯片和 Intel Mac**。

## 下载与使用

Windows 下载 `NCM-MP3-Windows-x64.zip`；M 系列 Mac 下载 `NCM-MP3-macOS-arm64.zip`；Intel Mac 下载 `NCM-MP3-macOS-x64.zip`。完整解压后运行 EXE 或 `.app`。

无需安装 Python、Node.js 或 FFmpeg；请保留文件夹内的所有文件，不要只复制 EXE，也不要在压缩包中直接运行。

## 功能

- 新增普通 FLAC 直接转 MP3，与加密文件可混合批量添加；LRC 歌词文件不处理。

- 批量添加 NCM 文件，或递归添加整个文件夹，支持拖放和自动去重。
- 选择输出位置，查看逐首进度、失败原因，支持取消和重试。
- FLAC 转码支持 320 / 256 / 192 kbps，输出为 44.1 kHz MP3，默认 320 kbps。
- 内层已经是 MP3 时直接还原音频流，保留原有码率与采样率，避免二次压缩。
- 保留可读取的歌名、歌手和专辑信息；此版本不写入封面。
- 本地离线处理，保留原始 NCM；同名成品自动另存，不覆盖已有文件。
- 每首歌都在完整解码检查通过后保存成品。

## 验证状态

59 项自动测试通过，包含真实短音频转换和批量控制流程；界面使用模拟接口检查。

本版本在 macOS 上制作。Apple 芯片 Mac 原生界面与混合批量转换验收通过；Windows、Intel Mac 尚未实机验收；Mac 仅有本地临时签名，未作 Apple 开发者签名和公证。各平台最终验收情况见 `docs/测试记录.md`。损坏或非标准 NCM 文件可能无法转换。

## 源码与第三方软件

应用源码使用 MIT 许可。随包 Electron、Chromium 和 FFmpeg 保留各自许可，具体见包内 `THIRD_PARTY_NOTICES.md`、`LICENSE-electron`、`LICENSES.chromium.html` 与 `licenses/ffmpeg/`。

**FFmpeg 对应源码获取指引：**见本仓库 `docs/第三方源码.md` 及发行包内 `docs/第三方源码.md`。精确版本、上游下载链接与 SHA-256 记录在包内 `BUILD-MANIFEST.json`。

下载旁附有统一 `SHA256SUMS.txt` 校验清单和 `NCM-MP3-Source.zip` 完整源码。
