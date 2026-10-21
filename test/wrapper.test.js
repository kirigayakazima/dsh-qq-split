import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

function createFakeSender() {
  const calls = []
  const sender = {
    name: 'fake-sender',
    sendMarkdown: async function (target, content, opts) {
      // 验证 this 指向 sender 本身
      assert.equal(this.name, 'fake-sender')
      calls.push({ target, content, opts, at: Date.now() })
      return { ok: true }
    },
    getCalls() {
      return calls
    },
    clear() {
      calls.length = 0
    },
  }
  return sender
}

function createFakeCtx(sender) {
  let disposer = null
  return {
    qqbotSender: sender,
    effect: (fn) => {
      disposer = fn()
    },
    dispose: () => {
      if (typeof disposer === 'function') disposer()
    },
  }
}

test('短文本（< minChars）不切分，只调用 1 次', async () => {
  const sender = createFakeSender()
  const ctx = createFakeCtx(sender)
  apply(ctx, { minChars: 120, delayMs: 10 })

  await sender.sendMarkdown({ scope: 'c2c', targetId: 'user1' }, '短消息回答。', undefined)
  assert.equal(sender.getCalls().length, 1)
  assert.equal(sender.getCalls()[0].content, '短消息回答。')
})

test('带 opts（如 keyboard 按钮）时绝不切分，只调用 1 次且原样透传 opts', async () => {
  const sender = createFakeSender()
  const ctx = createFakeCtx(sender)
  apply(ctx, { minChars: 20, delayMs: 10 })

  const longText = '这是一段很长的问答文本，包含足够的字符数。请问您需要选择哪一个操作？点击下方按钮确认。'
  const opts = { keyboard: { rows: [] } }
  await sender.sendMarkdown({ scope: 'c2c', targetId: 'user1' }, longText, opts)

  assert.equal(sender.getCalls().length, 1)
  assert.equal(sender.getCalls()[0].content, longText)
  assert.deepEqual(sender.getCalls()[0].opts, opts)
})

test('跳过前缀（🔧 工具结果、❌ 错误、⚠️ 轮次异常）不切分，只调用 1 次', async () => {
  const sender = createFakeSender()
  const ctx = createFakeCtx(sender)
  apply(ctx, { minChars: 20, delayMs: 10 })

  const toolText = '🔧 执行结果返回成功。包含了很多字数，详细记录了工具运行过程和各项指标，不要对此切分。'
  await sender.sendMarkdown({ scope: 'c2c', targetId: 'user1' }, toolText, undefined)
  assert.equal(sender.getCalls().length, 1)
  assert.equal(sender.getCalls()[0].content, toolText)

  sender.clear()
  const errorText = '❌ 执行过程发生异常。详细堆栈信息如下，请系统管理员注意排查，不要对错误报告切分。'
  await sender.sendMarkdown({ scope: 'c2c', targetId: 'user1' }, errorText, undefined)
  assert.equal(sender.getCalls().length, 1)
  assert.equal(sender.getCalls()[0].content, errorText)

  sender.clear()
  const warnText = '⚠️ 当前会话超时未响应。请重新发送消息或刷新窗口重试，此提示保持单条发送。'
  await sender.sendMarkdown({ scope: 'c2c', targetId: 'user1' }, warnText, undefined)
  assert.equal(sender.getCalls().length, 1)
  assert.equal(sender.getCalls()[0].content, warnText)
})

test('普通长文本切分为 2–3 次调用，内容按顺序发送，且段间有延迟', async () => {
  const sender = createFakeSender()
  const ctx = createFakeCtx(sender)
  apply(ctx, { minChars: 30, targetChars: 50, maxSegments: 3, delayMs: 50 })

  const longText = [
    '这是第一句很长的话，详细描述了项目启动的初衷和核心目标。',
    '这是第二句很长的话，解释了系统各个组件之间的通信方式与时序流程。',
    '这是第三句很长的话，给出了详细的部署方案与回滚测试步骤说明。',
  ].join('')

  await sender.sendMarkdown({ scope: 'c2c', targetId: 'user1' }, longText, undefined)
  const calls = sender.getCalls()

  assert.ok(calls.length >= 2 && calls.length <= 3)

  // 拼接还原校验
  const cleanOriginal = longText.replace(/\s+/g, '')
  const cleanJoined = calls.map((c) => c.content).join('').replace(/\s+/g, '')
  assert.equal(cleanJoined, cleanOriginal)

  // 验证分段调用时 opts 为 undefined
  for (const c of calls) {
    assert.equal(c.opts, undefined)
  }

  // 验证段间延迟（每次间隔至少接近 50ms）
  if (calls.length >= 2) {
    const diff = calls[1].at - calls[0].at
    assert.ok(diff >= 40, `Interval should be at least 40ms, got ${diff}ms`)
  }
})

test('群聊消息（target.scope=group）最多切分为 2 段', async () => {
  const sender = createFakeSender()
  const ctx = createFakeCtx(sender)
  apply(ctx, { minChars: 30, targetChars: 40, groupMaxSegments: 2, delayMs: 10 })

  const longText = [
    '第一句解释背景并提出问题。',
    '第二句详细列举当前面临的挑战和阻碍。',
    '第三句探讨可能的解决思路与技术方案。',
    '第四句给出具体的行动计划与分工安排。',
  ].join('')

  await sender.sendMarkdown({ scope: 'group', targetId: 'group1' }, longText, undefined)
  const calls = sender.getCalls()
  assert.equal(calls.length, 2)
})

test('单条分段发送失败时停止后续分段发送，避免重复', async () => {
  let callCount = 0
  const failingSender = {
    name: 'fake-sender',
    sendMarkdown: async function () {
      callCount++
      if (callCount === 2) {
        throw new Error('QQ API send failed')
      }
      return { ok: true }
    },
  }
  const ctx = createFakeCtx(failingSender)
  apply(ctx, { minChars: 30, targetChars: 40, maxSegments: 3, delayMs: 10 })

  const longText = [
    '第一句解释背景并提出问题。',
    '第二句详细列举当前面临的挑战和阻碍。',
    '第三句探讨可能的解决思路与技术方案。',
    '第四句给出具体的行动计划与分工安排。',
  ].join('')

  await failingSender.sendMarkdown({ scope: 'c2c', targetId: 'user1' }, longText, undefined)
  // 第一次成功，第二次抛错并中断，第三段不应再发送
  assert.equal(callCount, 2)
})

test('插件卸载（dispose）时能完全恢复原生 sendMarkdown', async () => {
  const sender = createFakeSender()
  const origFunc = sender.sendMarkdown
  const ctx = createFakeCtx(sender)

  apply(ctx, { minChars: 30, targetChars: 40, delayMs: 10 })
  assert.notEqual(sender.sendMarkdown, origFunc)

  // 卸载
  ctx.dispose()
  assert.equal(sender.sendMarkdown, origFunc)
})
