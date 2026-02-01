# macOS 安装说明

## 常见问题：提示"应用已损坏，无法打开"

如果您在打开 **AI Media Captions** 时看到以下错误：

> "AI Media Captions" 已损坏，无法打开。你应该将它移到废纸篓。

**请不要担心！这不是应用程序真的损坏了。**

### 原因说明

这是 macOS 的安全机制（Gatekeeper）导致的。由于应用未经过 Apple 官方公证，macOS 会阻止从互联网下载的应用运行。您的文件是完整且安全的。

---

## 解决方法

### 方法一：使用终端命令（推荐）

1. 打开 **终端**（Terminal）
   - 按 `Command + 空格`，输入 `终端` 或 `Terminal`，回车打开

2. 复制并运行以下命令：

   **如果应用在"应用程序"文件夹中：**
   ```bash
   xattr -cr /Applications/AI\ Media\ Captions.app
   ```

   **如果应用在"下载"文件夹中：**
   ```bash
   xattr -cr ~/Downloads/AI\ Media\ Captions.app
   ```

3. 运行命令后，双击应用即可正常打开

---

### 方法二：通过系统设置允许

1. 尝试打开应用（会提示损坏）
2. 打开 **系统设置** > **隐私与安全性**
3. 向下滚动，找到安全性部分
4. 您会看到关于 "AI Media Captions" 被阻止的提示
5. 点击 **仍要打开**
6. 在弹出的对话框中点击 **打开**

---

## 注意事项

- 此操作只需执行一次，之后应用可以正常使用
- 这是从互联网下载的未签名应用的常见问题，不是安全风险
- 如果您仍有疑虑，可以使用杀毒软件扫描应用后再运行

---

## 需要帮助？

如果您遇到其他问题，请在 GitHub 上提交 Issue：
https://github.com/ChrisZhang0806/AI-Powered-Media-Captions/issues
