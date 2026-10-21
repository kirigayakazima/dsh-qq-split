# @dsh/qq-split

DSH（DeepSeek Harness）的 QQ 机器人消息断句出口适配器。

不修改模型本身的输出与思考过程，在 QQ 机器人出口处（`sendMarkdown`）将长回复按标点和自然句子切分成 2–3 条短消息逐条发送，模拟真人在 QQ 上打字的自然节奏。

---

## 核心特性

- **出口按句切分**：中文按 `。！？…` 切分，英文按 `.!?` 切分（自动识别 `$3.14` 小数点、`v1.2` 版本号、`e.g.` 缩写不乱切）。
- **结构完整保护**：Markdown 围栏代码块、GFM 表格、URL 链接、行内代码完整保留，绝不从中断开。
- **额度安全控制**：QQ 被动回复单次最多 4 条回复额度。私聊默认最多切 3 段（留 1 条给工具结果或异常），群聊默认最多切 2 段；多余尾部合并至末段，绝不截断丢弃。
- **敏感场景直通**：问答/审批带按钮（`opts.keyboard`）、工具结果（`🔧`/`❌`）、轮次异常（`⚠️`）以及短消息自动直通，绝不切分。
- **失败熔断机制**：分段发送若某一段失败，立即停止后续分段发送，避免重复发送或级联报错。

---

## 前置依赖：给 qqbot 打 1 行钩子补丁

由于 `@tencent-connect/dsh-qqbot` 默认未将 `sender` 暴露给兄弟插件，需要在该包中暴露 `qqbotSender`。

### 补丁位置
`/root/.dsh/plugin-src/@tencent-connect/dsh-qqbot/dist/gateway/bootstrap.js`

在 `const sender = { ... };` 后面加上一行：
```js
ctx.provide('qqbotSender', sender);
```

或者在 qqbot 目录下直接执行 git patch：
```sh
cd /root/.dsh/plugin-src/@tencent-connect/dsh-qqbot
patch -p1 < /path/to/dsh-qq-split/patches/qqbot-0.5.2-sender-hook.patch
```

> **注意**：如果未来升级了 `@tencent-connect/dsh-qqbot`，重打此 1 行补丁即可。未打补丁时，断句插件会因为找不到 `qqbotSender` 依赖而安全静默不加载。

---

## 安装与配置

### 1. 关掉 QQBot 流式（必须）
流式（`streaming: true`）直接走内部 `StreamingWriter`，不流经 `sendMarkdown` 出口。
需在 profile 的 `cordis.patch.yml` 中关闭：

```yaml
- id: im-qqbot
  config:
    streaming: false
```

### 2. 注册并配置插件
在 `cordis.patch.yml` 中添加配置，并将 `@dsh/qq-split` 加进 profile 的 `dsh.profile.bundles`：

```yaml
- id: qq-split
  name: "@dsh/qq-split"
  config:
    enabled: true
    minChars: 120
    targetChars: 140
    maxSegments: 3
    groupMaxSegments: 2
    delayMs: 500
    protectCode: true
```

---

## 安装与回滚（各 5 行）

### 安装
```sh
# 1. 链接或安装插件
cd /root/.dsh/plugin-src && git clone https://github.com/kirigayakazima/dsh-qq-split
# 2. 为 qqbot 打入 1 行补丁并修改 cordis.patch.yml（streaming: false + 启用 qq-split）
# 3. 重启手机端 DSH 进程即可生效
```

### 回滚
```sh
# 1. 修改 cordis.patch.yml：将 im-qqbot 的 streaming 改回 true，移除 qq-split 配置
# 2. 从 profile 的 bundles 中移除 @dsh/qq-split
# 3. 重启 DSH 即可完全恢复原生一大段发送（qqbot 补丁不产生任何副作用）
```

---

## 配置参数说明

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | `boolean` | `true` | 是否启用断句切分 |
| `minChars` | `number` | `120` | 回复长度小于此字符数时不切分，保持单条 |
| `targetChars` | `number` | `140` | 每段目标期望长度 |
| `maxSegments` | `number` | `3` | 私聊最多分几段（QQ 被动回复额度 4 次，留 1 次） |
| `groupMaxSegments` | `number` | `2` | 群聊最多分几段（群聊更克制） |
| `delayMs` | `number` | `500` | 分段发送间隔延迟（毫秒） |
| `protectCode` | `boolean` | `true` | 代码块和表格是否作为整体保护 |
| `skipPrefixes` | `string[]` | `['🔧', '❌', '⚠️']` | 跳过断句的消息前缀 |

---

## 单测验证

```sh
cd dsh-qq-split
node --test
```
覆盖纯函数切分算法（中文标点、英文数字缩写、代码块、表格、URL、长无标点段落）与假 sender 包装器行为（opts 跳过、前缀跳过、延迟间隔、群聊段数、错误熔断、卸载恢复）。
