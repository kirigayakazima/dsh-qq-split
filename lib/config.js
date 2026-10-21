// 配置定义与默认参数
let Schema = null
try {
  const mod = await import('@deepseek-ai/schemastery')
  Schema = mod.default || mod
} catch {
  // 无宿主环境时优雅降级
}

export const DEFAULT_CONFIG = {
  enabled: true,
  minChars: 120,
  targetChars: 140,
  maxSegments: 3,
  groupMaxSegments: 2,
  delayMs: 500,
  protectCode: true,
  skipPrefixes: ['🔧', '❌', '⚠️'],
}

export const Config = Schema
  ? Schema.object({
      enabled: Schema.boolean().default(true).description('是否启用断句切分'),
      minChars: Schema.number().default(120).description('短于此字符数不进行断句'),
      targetChars: Schema.number().default(140).description('每段目标期望长度'),
      maxSegments: Schema.number().default(3).description('私聊最多分几段（QQ 被动回复额度 4 次，留 1 次）'),
      groupMaxSegments: Schema.number().default(2).description('群聊最多分几段'),
      delayMs: Schema.number().default(500).description('分段发送间隔延迟（毫秒）'),
      protectCode: Schema.boolean().default(true).description('代码块/表格整体保护不切断'),
      skipPrefixes: Schema.array(Schema.string()).default(['🔧', '❌', '⚠️']).description('跳过断句的消息前缀'),
    })
  : null

export function resolveConfig(userConfig = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    skipPrefixes: Array.isArray(userConfig?.skipPrefixes) ? userConfig.skipPrefixes : DEFAULT_CONFIG.skipPrefixes,
  }
}
