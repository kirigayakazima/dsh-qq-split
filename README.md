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

## 前置依赖：给 qqbot 暴露 sender 钩子（1行代码）

由于 `@tencent-connect/dsh-qqbot` 默认未将 `sender` 暴露给兄弟插件，需要暴露 `qqbotSender` 供断句插件注入。

### 自动打入补丁（单行 Node 脚本，最安全防转义）
在手机终端直接执行下面命令：
```sh
node -e '
const fs = require("fs");
const file = "/root/.dsh/plugin-src/@tencent-connect/dsh-qqbot/dist/gateway/bootstrap.js";
let s = fs.readFileSync(file, "utf8");
if (!s.includes("qqbotSender")) {
  s = s.replace(/(const sender = \{[\s\S]*?\n    \};)/, "$1\n    ctx.provide(\x27qqbotSender\x27, sender);");
  fs.writeFileSync(file, s, "utf8");
  console.log("Hook patched successfully!");
} else {
  console.log("Already patched.");
}
'
```

### 验证补丁是否成功打入
```sh
grep "qqbotSender" /root/.dsh/plugin-src/@tencent-connect/dsh-qqbot/dist/gateway/bootstrap.js
```
若输出包含 `ctx.provide('qqbotSender', sender);` 则说明补丁已就绪！

> **注意**：如果未来升级了 `@tencent-connect/dsh-qqbot`，重跑此脚本即可。未打补丁时，断句插件会因为找不到 `qqbotSender` 依赖而安全静默不加载。

---

## 安装与配置

### 1. 关掉 QQBot 流式（必须）
流式（`streaming: true`）直接走内部 `StreamingWriter`，不流经 `sendMarkdown` 出口。
需在 profile 的 `/root/.dsh/profiles/web/cordis.patch.yml` 中关闭：

```yaml
- id: im-qqbot
  config:
    streaming: false
```

### 2. 注册插件（与 `@dsh/heart` 同理）
在 `/root/.dsh/profiles/web/package.json` 中的 `dsh.profile.bundles` 加入 `"@dsh/qq-split"`：

```json
{
  "dependencies": {
    "@dsh/qq-split": "link:/root/.dsh/plugin-src/@dsh/qq-split"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@tencent-connect/dsh-qqbot",
        "@dsh/heart",
        "@dsh/qq-split"
      ]
    }
  }
}
```

插件本身已包含 bundle patch（`- insert:`），无需在 profile 的 patch 额外手动 insert。如需自定义配置（如间隔时长、触发字数），可在 profile 的 `cordis.patch.yml` 追加覆盖：

```yaml
- id: dsh-qq-split
  config:
    minChars: 120
    targetChars: 140
    maxSegments: 3
    delayMs: 500
```

---

## 快速安装与重启

```sh
# 1. 下载或更新插件
cd /root/.dsh/plugin-src
git clone https://github.com/kirigayakazima/dsh-qq-split.git @dsh/qq-split 2>/dev/null || (cd @dsh/qq-split && git pull)

# 2. 执行上面的 Node 单行脚本为 qqbot 打入 hook 补丁

# 3. 确保 profile 的 cordis.patch.yml 已设 streaming: false，package.json 已包含 bundles 注册

# 4. 重启手机端 DSH 进程即可生效
```

### 验证加载
重启 DSH 后观察控制台或日志输出：
看到 `[qq-split] initialized successfully, sendMarkdown wrapped` 即代表插件成功加载并挂载出口！
发送长消息时会输出：`[qq-split] splitting outbound message into X segments`。
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
