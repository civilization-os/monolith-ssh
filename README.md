# MonolithSSH

基于 Electron、Vite、xterm.js 与 ssh2 的轻量本地 SSH 模拟器。应用会在本机启动真实 SSH 服务，可模拟 Linux 主机和网络设备，并在桌面终端或系统自带的 SSH 客户端中连接。

当前版本是单机 Electron 工具：没有独立 Web 服务、数据库、多用户和 Docker 依赖。

## 直接启动

首次使用先安装依赖：

```bash
npm install
```

日常启动直接运行：

```bash
npm start
```

`npm start` 会先构建渲染层，再打开 Electron。开发 UI 时使用热更新模式：

```bash
npm run dev
```

## 内置模拟实例

首次启动会创建两个仅监听本机地址的实例：

| 类型 | 地址 | 用户名 | 密码 |
| --- | --- | --- | --- |
| 网络设备 | `127.0.0.1:2222` | `admin` | `monolith` |
| Linux | `127.0.0.1:2223` | `root` | `monolith` |

也可以从外部终端连接：

```bash
ssh -p 2222 admin@127.0.0.1
ssh -p 2223 root@127.0.0.1
```

网络设备支持 EXEC、特权、全局配置和接口配置模式；Linux 模拟器提供虚拟文件系统和常用命令。它们用于教学、演示和客户端联调，不是完整操作系统或设备固件。

实例配置、主机密钥、模拟状态和审计日志存放在 Electron 的用户数据目录下的 `simulator/` 中，不写入项目目录。

## 实例登录凭据

新建实例时可以指定实例名、用户名、监听端口和访问范围。默认绑定 `127.0.0.1`，也可选择 `0.0.0.0` 允许局域网设备连接；开放局域网时应使用强凭据并只在 Windows 防火墙中允许可信网络。认证方式包括：

- 密码：填写自定义密码，或生成 16–64 位随机密码。
- SSH 公钥：粘贴已有 OpenSSH 公钥，或由应用生成 RSA-3072 密钥对。
- 密码 + 公钥：两种凭据任意一种都可以登录。

创建完成后会显示连接命令和需要交付的凭据。之后可随时从实例行的“连接信息”查看命令、用户名、认证方式和授权公钥，密码默认遮罩并按需显示或复制。应用生成的私钥通过 Electron `safeStorage` 加密保存在用户数据目录的 `credentials.bin`，供内置 xterm.js 终端重连使用，也可从“连接信息”通过系统保存对话框再次导出；页面不会直接读取托管私钥。粘贴外部公钥但未提供对应私钥的实例只能从外部 SSH 客户端连接。

当前 `ssh2` 版本对生成式客户端密钥采用兼容性稳定的 RSA-3072；服务端仍接受可被 `ssh2` 解析的外部 OpenSSH 公钥，包括 Ed25519。这里的登录密钥用于客户端认证，与每个实例自动生成的 SSH 主机密钥是两套独立凭据。

## 界面语言

应用支持简体中文和 English，可通过顶部语言选择器即时切换，选择结果会保存在本机。界面翻译资源统一位于 `src/locales/`；SSH 命令、设备回显和终端协议内容保持原文，避免影响模拟行为。

## 自定义命令规则

配置页支持两层实时命令规则：

- 类型级：作用于全部 Linux 实例或全部网络设备实例。
- 设备级：仅作用于指定实例，并优先于同名类型级规则。

最终匹配顺序为“设备级规则 → 类型级规则 → 内置命令”。点击“保存并立即生效”后，已经建立的 SSH 会话无需重连，下一条命令就会读取新规则。规则持久化在 Electron 用户数据目录的 `simulator/command-rules.json`。

## 交互式规则与变量

Linux 与网络设备命令规则都支持“直接返回输出”和“收集输入并改变状态”两种行为。交互式规则由可排序的受控步骤组成，当前支持等待输入、变量校验、选项校验、切换用户、切换设备模式、输出内容和结束流程。步骤可以新增、删除和上下移动，不执行任意脚本。

默认提供 `su` 规则，支持 `su USER`；输入 `SU_PASSWORD` 变量对应的值后切换用户，执行 `exit` 返回切换前的用户。原有固定格式的交互规则会在加载时自动迁移到步骤格式。网络设备可以使用相同引擎配置 `enable → 密码校验 → privileged_exec`，Yes/No 确认则使用“等待输入 → 校验选项”组合。

变量管理器会展示 `hostname`、`instance`、`user`、`command`、`arg1`、`input` 六个只读系统变量，也支持新增、编辑、删除和标记敏感的自定义变量。自定义变量持久化在 Electron 用户数据目录的 `simulator/variables.json`，保存后已有 SSH 会话立即读取新值。敏感交互输入不会回显，也不会写入命令历史或审计内容。

## Linux 内置命令

Linux 模拟器内置 24 组常用命令，包含目录与文件操作、系统信息、进程、网络、磁盘和内存查询等能力。可在“配置 → Linux 内置命令”中逐条删除；删除会持久化为停用状态，并让已经建立的 Linux SSH 会话从下一条命令开始立即生效。点击“一键还原默认命令”可恢复全部内置命令。

停用状态保存在 Electron 用户数据目录的 `simulator/linux-builtins.json`。自定义的设备级或 Linux 类型级同名规则优先级仍高于内置命令，因此也可以用自定义回显覆盖默认行为。

## MCP SSE 操作口

设置页提供默认关闭的本地 MCP 开关。开启后固定监听 `127.0.0.1:3765`，提供 20 个工具，覆盖实例生命周期与详情、连接凭据、认证实时更新、监听端点、端口诊断与修复、命令执行、命令规则、变量、Linux 内置命令和审计筛选。所有调用都会在进入业务服务前按声明的 JSON Schema 校验参数。

兼容传统 SSE transport 的客户端可以使用：

```json
{
  "mcpServers": {
    "monolithssh": {
      "url": "http://127.0.0.1:3765/sse",
      "transport": "sse"
    }
  }
}
```

同时提供现代无状态 Streamable HTTP 端点 `http://127.0.0.1:3765/mcp`。MCP 网关不保存调用参数、返回结果、连接历史或业务数据；传统 SSE 只在内存中保留当前连接句柄，断开即销毁。实例、规则、变量和审计仍由 MonolithSSH 原有本地服务管理并按原方式持久化。开关与端口属于应用偏好，保存在用户数据目录的 `mcp-settings.json`。

这是完整控制接口，没有远程访问和独立鉴权层。服务固定绑定本机地址并校验 Host/Origin，但仍应只连接可信 MCP 客户端；不用时请关闭。变量和实例密码默认返回 `***`，只有显式传入 `includeSecrets: true` 才会返回明文；应用托管私钥永远不会通过 MCP 返回。工具声明包含只读、幂等、破坏性和开放世界提示，删除实例或替换公钥时也会同步清理失效的加密私钥。

## 构建

```bash
npm run build
npm run dist
npm run dist:win64
```

- `npm run build` 构建渲染层至 `dist/`
- `npm run dist` 生成 Windows 安装包至 `release/`
- `npm run dist:win64` 仅生成 Windows x64 NSIS 安装包，用于 GitHub Release
- `npm run check` 检查主进程、模拟服务语法、构建 UI，并验证 Electron 的相对资源路径
- `npm run smoke:ssh` 使用真实 SSH 客户端验证 Linux、网络设备和交互终端链路
- `npm run smoke:mcp` 验证 20 个工具、参数校验、现代 HTTP/SSE、传统 SSE、端口诊断和敏感值脱敏
- `npm run smoke:bind` 验证 `127.0.0.1` 与 `0.0.0.0` 监听切换
- `npm run smoke:ports` 验证端口冲突诊断、自动修复和恢复原端口

## CI/CD 与发布

- `.github/workflows/ci.yml` 在提交到 `main`、`agent/**` 或面向 `main` 的 PR 上使用 Windows x64 执行完整检查与冒烟测试。
- `.github/workflows/release.yml` 在推送 `v*` 标签或手动触发时执行完整验证，只构建 Windows x64 的 `.exe` 安装包，并发布到 GitHub Release。
- 发布标签必须与 `package.json` 中的版本一致，例如版本 `0.1.0` 对应标签 `v0.1.0`。
- Release 附件包含 `MonolithSSH-<version>-Setup.exe` 与 `SHA256SUMS.txt`，不会上传 macOS、Linux 或其他 Windows 架构产物。

```bash
git tag v0.1.0
git push origin v0.1.0
```

Electron 主进程位于 `electron/main.cjs`，SSH 模拟服务位于 `simulator/`，预加载桥接位于 `electron/preload.cjs`，渲染层入口位于 `src/main.js`。

## UI 结构

```text
src/
├─ locales/             # zh-CN / en-US 界面翻译资源
├─ ui/                  # 应用壳、图标等共享 UI
├─ views/               # Dashboard / Instances / Terminal / Profiles / Audit / Settings
└─ styles/
   ├─ tokens.css        # 唯一的颜色、字体、间距、尺寸、圆角和动效令牌源
   ├─ base.css          # Reset 与元素基础样式
   ├─ layout.css        # 应用壳和页面布局
   ├─ components.css    # 导航、按钮、表格等公共组件
   ├─ pages.css         # 页面专属组合样式
   ├─ responsive.css    # 集中管理断点与响应式覆盖
   └─ index.css         # CSS 统一入口
```

新增 UI 样式时，先在 `tokens.css` 定义设计令牌，再在其他样式文件中通过 `var(--token-name)` 使用。除媒体查询断点外，不在组件或页面样式中写死颜色与固定尺寸。

## 产品文档

- [第一版 V1 与最终版功能差异](docs/FEATURE_COMPARISON.md)
