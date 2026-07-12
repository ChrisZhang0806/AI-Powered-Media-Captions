# UI Copy Guide

本文档列出项目中所有用户可能看到的文案，包括网页界面、处理进度、错误提示、辅助功能标签和桌面端启动错误。开发日志、代码注释和协议字段不属于界面文案，不纳入清单。

## 文案原则

- 核心术语统一使用“转写 / transcription”，不混用“解析、捕获、识别、处理”。
- 语气保持简洁、平静、专业，不使用“智能、快速路径、引擎核心”等宣传或实现术语。
- 按钮使用明确动词，例如“开始转写、导出字幕、验证并保存”。
- 进度标题只说明当前阶段；数量、比例和传输量放在次级信息中。
- 错误信息说明发生了什么，并在可行时给出下一步。
- 不向用户展示 Cloud Run、API 端点、分片策略或服务端内部状态。

## 品牌与页面元数据

| 使用位置 | 中文 | English |
| --- | --- | --- |
| 产品名称、浏览器标题 | AI 视频字幕 | AI Media Captions |
| 产品说明 | 为音频和视频生成、编辑并导出 SRT、VTT 或纯文本字幕。 | Generate, edit, and export SRT, VTT, or plain-text captions for audio and video. |

## Header 与 API 密钥

| Key / 使用位置 | 中文 | English |
| --- | --- | --- |
| `apiKey` | OpenAI API 密钥 | OpenAI API key |
| `configApiKey` | 设置 OpenAI API 密钥 | Set OpenAI API key |
| `apiKeyTip` | 密钥仅保存在此浏览器中。媒体文件只会在开始转写后发送。 | Your key stays in this browser. Media is sent only after you start transcription. |
| `getApiKey` | 获取密钥 | Get a key |
| `viewUsage` | 查看用量 | View usage |
| `deleteKey` | 移除密钥 | Remove key |
| `confirmDelete` | 确认移除 | Confirm removal |
| `confirmReset` | 此操作会清除当前字幕和处理进度。是否继续？ | This clears the current captions and processing progress. Continue? |
| `cancel` | 取消 | Cancel |
| `verifyAndConfirm` | 验证并保存 | Verify and save |

## 文件与媒体信息

| Key / 使用位置 | 中文 | English |
| --- | --- | --- |
| `uploadTip` | 选择或拖入媒体或字幕文件 | Choose or drop a media or caption file |
| `dropFileHere` | 松开以导入文件 | Drop to import file |
| `supportFormat` | MP4、TS、MP3、WAV、SRT、VTT | MP4, TS, MP3, WAV, SRT, VTT |
| `mediaPreview` | 媒体预览 | Media preview |
| `mediaFormat` | 格式 | Format |
| `mediaDuration` | 时长 | Duration |
| `mediaResolution` | 分辨率 | Resolution |
| `mediaVideoCodec` | 视频编码 | Video codec |
| `mediaAudioCodec` | 音频 | Audio |
| `mediaFileSize` | 文件大小 | File size |
| `mono` | 单声道 | Mono |
| `stereo` | 立体声 | Stereo |
| `removeFile` | 移除文件 | Remove file |
| `previewUnavailable` | 此格式无法在浏览器中预览，但仍可转写。 | This format cannot be previewed in the browser, but it can still be transcribed. |

## 转写输入与操作

| Key / 使用位置 | 中文 | English |
| --- | --- | --- |
| `contextPrompt` | 转写提示 | Transcription prompt |
| `contextPromptTip` | 优化专有名词识别 | Improve recognition of names and terms |
| `contextPromptPlaceholder` | 例如：人名、术语或内容背景 | For example: names, terminology, or context |
| `startProcess` | 开始转写 | Start transcription |

## 字幕与导出

| Key / 使用位置 | 中文 | English |
| --- | --- | --- |
| `subtitlePreview` | 字幕预览 | Caption preview |
| `textOnly` | TXT（纯文本） | TXT (plain text) |
| `exportSubtitle` | 导出字幕 | Export captions |
| `formatType` | 文件格式 | File format |
| `noSubtitles` | 转写完成后，字幕将显示在这里 | Captions will appear here after transcription |
| `playPosition` | 时间码 | Timecode |
| `originalContent` | 字幕内容 | Caption text |
| `manage` | 操作 | Actions |
| `selectExportOptions` | 选择导出格式 | Choose export format |
| `exportOptions` | 导出格式 | Export format |
| `saveCaption` | 保存字幕 | Save caption |
| `editCaption` | 编辑字幕 | Edit caption |

## 处理进度

进度标题不使用省略号。加载图标和进度条已经表达“仍在进行”，无需通过标点重复表达。

| Key / 使用阶段 | 中文 | English |
| --- | --- | --- |
| `progressPreparing` | 正在准备转写 | Preparing transcription |
| `progressUploading` | 正在上传媒体 | Uploading media |
| `progressQueued` | 正在等待处理 | Waiting to process |
| `progressExtracting` | 正在提取音频 | Extracting audio |
| `progressSegmenting` | 正在准备音频 | Preparing audio |
| `progressTranscribing` | 正在转写 | Transcribing |
| `progressFinalizing` | 正在生成字幕 | Generating captions |
| `progressDone` | 字幕已生成 | Captions are ready |
| `progressGenerated` | 已生成 `{count}` 条字幕 | `{count}` captions generated |
| `progressUploadDetail` | `{percent}% · {uploaded} / {total}` | `{percent}% · {uploaded} / {total}` |
| `progressAudioOnlyDetail` | 仅上传音频，约 `{size}` | Audio only, about `{size}` |
| `progressSegmentsDetail` | 已完成 `{completed}/{total}` 段 · 音频 `{uploaded} / {size}` | `{completed}/{total}` segments complete · audio `{uploaded} / {size}` |
| `progressSegmentDetail` | 第 `{index}` 段 | Segment `{index}` |

## 错误与恢复

| Key / 场景 | 中文 | English |
| --- | --- | --- |
| `errorNoApiKey` | 请先设置 OpenAI API 密钥。 | Set an OpenAI API key before starting transcription. |
| `errorInvalidApiKey` | 无法验证此密钥。请检查后重试。 | This key could not be verified. Check it and try again. |
| `errorInvalidSub` | 无法读取字幕文件。请确认文件为有效的 SRT 或 VTT 格式。 | The caption file could not be read. Choose a valid SRT or VTT file. |
| `errorProcessFailed` | 转写失败。请重试。 | Transcription failed. Try again. |
| `errorServerUnavailable` | 无法连接转写服务。请稍后重试。 | The transcription service is unavailable. Try again later. |
| `errorCreateUpload` | 无法开始上传。请重试。 | The upload could not be started. Try again. |
| `errorCompleteUpload` | 文件上传未完成。请重试。 | The upload did not finish. Try again. |
| `errorUpload` | 文件上传失败。请检查网络后重试。 | The file could not be uploaded. Check your connection and try again. |
| `errorAudioSegment` | 音频片段转写失败。请重试。 | An audio segment could not be transcribed. Try again. |
| `errorAudioExtract` | 无法从视频中提取音频。请检查文件后重试。 | Audio could not be extracted from this video. Check the file and try again. |
| `errorNoAudio` | 未检测到可转写的音频。请检查文件是否包含声音。 | No transcribable audio was found. Check that the file contains sound. |
| `errorInvalidFile` | 无法读取文件信息。请重新选择文件。 | The file information could not be read. Choose the file again. |
| `errorUnsupportedFile` | 不支持此文件格式。请选择音频、视频、SRT 或 VTT 文件。 | This file format is not supported. Choose an audio, video, SRT, or VTT file. |
| `errorFileTooLarge` | 文件超过 20 GB，无法上传。 | Files larger than 20 GB cannot be uploaded. |
| `errorFastPathUnavailable` | 仅音频上传服务暂时不可用。为避免上传完整的 `{size}` 视频，转写已停止。请稍后重试。 | Audio-only upload is temporarily unavailable. Transcription stopped to avoid uploading the full `{size}` video. Try again later. |
| `errorFastPathFormat` | 当前文件无法仅上传音频。为避免上传完整的 `{size}` 文件，转写已停止。请转换为带 AAC 或 Linear PCM 音轨的 MP4、MOV 或 M4V 后重试。 | Audio-only upload is unavailable for this file. Transcription stopped to avoid uploading the full `{size}` file. Convert it to MP4, MOV, or M4V with AAC or Linear PCM audio and try again. |
| `errorTaskCancelled` | 任务已取消。 | The task was cancelled. |
| Electron 启动错误 | 无法启动应用 / 应用服务未能启动。请重新打开应用后重试。 | Native fallback currently uses Chinese because it appears before app language settings load. |

## 已删除或替换的文案

| 原文案 | 处理 | 原因 |
| --- | --- | --- |
| AI 智能视频字幕 | 改为“AI 视频字幕” | “AI”与“智能”语义重复。 |
| AI 音视频字幕工作台 / 快速转写、语义断句…… | 删除 | 当前界面不显示营销标题，词表中不保留死文案。 |
| 开始 AI 解析 | 改为“开始转写” | “转写”准确描述结果，“AI 解析”含义模糊。 |
| AI 引擎启动中 | 改为“正在准备转写” | 不暴露实现概念。 |
| 音轨分段转写中... | 拆为“正在转写”与完成段数 | 主次信息更清楚，删除省略号。 |
| 音轨快速路径已启用 | 删除 | 用户不需要了解处理分支。 |
| 当前容器或音频编码不支持音轨快速路径，改用兼容上传 | 删除 | 小文件回退无需打断用户；上传进度已提供足够反馈。 |
| 仅扫描本地文件索引，不上传视频画面 | 删除 | 属于实现细节；保留“仅上传音频，约 X”即可。 |
| AI 正在分析音频内容 / AI 正在识别语音 | 合并为“正在转写” | 避免相邻阶段使用不同术语。 |
| 已捕获 N 条字幕段 | 改为“已生成 N 条字幕” | “捕获”不自然，“字幕段”冗余。 |
| 完成后显示字幕 | 删除 | 进度区已有状态与结果数量，不重复提示。 |
| 智能校对中 / 正在校对专业术语 | 删除 | 当前流程没有独立校对阶段。 |
| 没有字幕可下载（弹窗） | 删除 | 导出按钮在无字幕时已禁用，弹窗不可达且重复。 |
| Processing... | 删除 | 通用按钮改为显示调用方提供的本地化操作文案。 |
| Cloud Run、分段 API、部署版本缺失等错误细节 | 改为可执行的服务或格式提示 | 用户只需要知道任务为何停止以及如何恢复。 |

## 维护规则

- 新增用户可见文案时，必须同时添加中文和英文。
- 优先复用本文件中的术语；不要重新引入“解析、捕获、智能处理”等同义词。
- 动态错误必须在服务边界转换为 `UserFacingError`，不要直接展示网络库、OpenAI 或服务器堆栈信息。
- 新增或删除文案后，同步更新本清单。
