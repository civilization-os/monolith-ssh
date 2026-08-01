# MonolithSSH 功能范围：第一版 V1 与最终版

> 文档状态：Draft  
> 更新日期：2026-07-31  
> 用途：记录产品范围、技术演进方向与版本边界。

## 功能差异

| 能力 | 第一版 V1 | 最终版 |
| --- | --- | --- |
| 产品定位 | 可配置、确定性的本地 SSH 模拟器 | 支持虚拟设备、真实容器、复杂拓扑和自动化测试的 SSH 仿真平台 |
| 产品形态 | Electron 本地桌面应用 | 桌面控制台 + 独立服务端 + CLI/API |
| SSH 服务 | Node.js `ssh2`，运行于独立 Electron `utilityProcess` | 可继续使用 Node.js，或演进为独立 Go Daemon |
| 部署方式 | 单机、本地运行 | 单机、服务器、Docker 和 CI 环境 |
| 监听方式 | 每个实例分配独立本地端口 | 端口池、多网卡、多运行节点调度 |
| 并发目标 | 桌面规模，几十到几百个会话 | 大规模实验室，可通过运行节点水平扩展 |
| 网络设备 | 通用 CLI 模式状态机 | 多厂商、多版本语法和完整配置状态模型 |
| Linux | 轻量虚拟 Shell | 虚拟 Shell + Docker/Podman 真实 Linux |
| 命令处理 | Regex、静态输出、模板、内置命令和模式跳转 | 命令 AST、插件处理器、场景脚本和异步任务 |
| 文件系统 | 内存或 JSON 虚拟文件系统 | 权限模型、挂载、快照和容器文件系统 |
| 认证 | 密码、公钥和稳定 Host Key | 密码、公钥、证书、认证策略和故障注入 |
| SSH 能力 | Shell、Exec、PTY 和终端 Resize | SFTP、SCP、Subsystem 和 Port Forwarding |
| Terminal | xterm.js 单机交互终端 | 多标签、分屏、录制、回放和协作 |
| 审计 | 登录、命令、输出和断开记录 | 全链路事件、搜索、导出、时间轴和确定性回放 |
| 场景模拟 | 固定响应、延迟输出和简单状态变化 | 延迟、掉线、超时、重启、资源异常和拓扑故障编排 |
| 自动化兼容 | OpenSSH、PuTTY 和基础脚本连接 | Ansible、Netmiko、Nornir、Scrapli 和 CI 测试 |
| Profile | 本地 JSON/YAML、可视化编辑和导入导出 | 版本管理、继承、组合、签名、依赖锁定和 Profile Registry |
| 数据存储 | SQLite + Profile 文件 | SQLite/PostgreSQL + 对象存储 |
| 管理接口 | Electron IPC | REST/gRPC/WebSocket + CLI |
| 多用户 | 不支持 | 用户、组织、项目和 RBAC |
| 扩展方式 | 内置 Handler | SDK、插件和厂商适配器 |
| 安全隔离 | 默认仅监听 `127.0.0.1`，禁止 Profile 任意代码执行 | 沙箱、容器隔离、资源配额、租户隔离和审计策略 |
| 可观测性 | 本地状态和审计日志 | 结构化日志、指标、健康检查和告警 |
| 网络拓扑 | 不支持真实节点互联 | 拓扑定义、链路状态、故障注入和控制面模拟 |

## 第一版 V1 的交付边界

第一版必须具备：

- 真实 SSH Server，可被 xterm、OpenSSH 和 PuTTY 连接。
- 多实例启动、停止、端口自动分配和稳定 Host Key。
- 密码与公钥认证。
- PTY、Shell、Exec、Resize、退格和 Ctrl+C。
- 网络设备的 User EXEC、Privileged EXEC、Global Config 和 Interface Config 模式。
- Linux 虚拟目录、环境变量、用户状态和一组常用内置命令。
- Profile 的规则、模板、状态修改、模式跳转和导入导出。
- 登录、命令、输出、状态变化和断开审计。
- 实例与状态的本地持久化。

第一版明确不包含：

- 完整 Bash 或任意本机命令执行。
- Docker/Podman 容器运行时。
- 多用户协作与分布式节点。
- 任意 JavaScript/Python Profile 脚本。
- 完整 SFTP、SCP 和端口转发。
- 大规模网络拓扑和真实数据面转发。

## 最终版目标

最终版形成独立的 SSH 仿真平台：

- Electron、Web、CLI 和 CI 都作为控制客户端。
- Simulator Service 可以脱离 Electron 独立部署。
- 虚拟 CLI、真实 Linux 容器和外部适配器采用统一运行时接口。
- 支持厂商、设备类型和固件版本继承体系。
- 支持实验拓扑、时间线和故障场景编排。
- 支持自动化工具行为断言、Transcript 对比和 CI 退出码。
- 支持多运行节点、资源调度、多租户和集中审计。

## 不变的架构原则

为了让 V1 可以自然演进到最终版，以下边界从第一版开始保持稳定：

- Renderer 不直接操作 SSH Socket。
- Electron 主进程不承载 SSH 会话工作负载。
- SSH Transport、Session 和 Behavior Engine 分层。
- Linux 与网络设备共享传输和会话层，使用不同的行为适配器。
- Profile 是声明式数据，不允许默认执行任意宿主代码。
- Audit 通过统一事件接口写入。
- UI 通过稳定的 Session API 操作终端：`open`、`write`、`resize`、`close`。

## 推荐演进路线

```text
第一版 V1
Node.js ssh2
+ Electron utilityProcess
+ Network FSM
+ Virtual Linux
+ xterm.js
+ SQLite
+ Profile Editor
+ Audit

最终版
Standalone Simulator Service
+ Virtual Runtime
+ Container Runtime
+ Scenario Engine
+ Automation Test API
+ Distributed Runtime Nodes
```

核心原则：第一版追求确定、可配置、可测试；最终版追求真实、规模化、可编排。
