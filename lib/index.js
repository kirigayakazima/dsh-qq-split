// @dsh/qq-split 插件入口
// 包装 qqbotSender.sendMarkdown，在发送前切分为 2–3 条短消息。
import { Config, resolveConfig } from './config.js'
import { splitForQQ } from './split.js'

export const name = 'dsh-qq-split'
export const inject = ['qqbotSender']
export { Config, splitForQQ, resolveConfig }

/**
 * 判断当前出站消息是否满足断句条件：
 * - 启用了断句功能
 * - opts 为空（问答/审批带 keyboard 绝不切分）
 * - 不带跳过前缀（🔧 工具结果、❌ 错误、⚠️ 轮次异常等）
 * - 长度超过 minChars（默认 120）
 * - 不包含超过 3000 字符的超长代码块/表格
 */
export function shouldSplit(content, opts, config = {}, target = {}) {
  if (config.enabled === false) return false
  if (opts && Object.keys(opts).length > 0) return false
  if (typeof content !== 'string') return false
  const trimmed = content.trim()
  const minChars = config.minChars ?? 120
  if (trimmed.length < minChars) return false

  const skipPrefixes = Array.isArray(config.skipPrefixes)
    ? config.skipPrefixes
    : ['🔧', '❌', '⚠️']
  for (const prefix of skipPrefixes) {
    if (trimmed.startsWith(prefix)) return false
  }

  if (config.protectCode !== false) {
    const codeMatch = trimmed.match(/^[ \t]*(```|~~~)[\s\S]*?\1/m)
    if (codeMatch && codeMatch[0].length > 3000) return false
    const tableMatch = trimmed.match(/(?:^[ \t]*\|[^\n]+\|[ \t]*(?:\n|$)){2,}/m)
    if (tableMatch && tableMatch[0].length > 3000) return false
  }

  return true
}

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const sender = ctx && ctx.qqbotSender
  if (!sender || typeof sender.sendMarkdown !== 'function') {
    console.warn('[qq-split] ctx.qqbotSender not available or invalid, skipping wrapper')
    return
  }

  console.log('[qq-split] initialized successfully, sendMarkdown wrapped')
  const original = sender.sendMarkdown
  sender.sendMarkdown = async (target, content, opts) => {
    if (!shouldSplit(content, opts, config, target)) {
      return original.call(sender, target, content, opts)
    }

    const isGroup = target && target.scope === 'group'
    const parts = splitForQQ(content, { ...config, isGroup })
    if (parts.length <= 1) {
      return original.call(sender, target, content, opts)
    }

    console.log(`[qq-split] splitting outbound message into ${parts.length} segments (total ${content.length} chars)`)
    for (let i = 0; i < parts.length; i++) {
      try {
        await original.call(sender, target, parts[i], undefined)
      } catch (err) {
        console.error(`[qq-split] segment ${i + 1}/${parts.length} failed:`, err)
        break
      }
      if (i < parts.length - 1 && config.delayMs > 0) {
        await new Promise((r) => setTimeout(r, config.delayMs))
      }
    }
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      console.log('[qq-split] unloaded, restoring original sendMarkdown')
      sender.sendMarkdown = original
    })
  }
}
