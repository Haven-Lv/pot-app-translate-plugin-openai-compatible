// 真实服务联调测试(可选):直接用插件代码请求一个真实的 OpenAI 兼容服务
// 用法:
//   POT_LIVE_BASE=http://127.0.0.1:3425/v1 POT_LIVE_KEY=magpie POT_LIVE_MODEL=codearts/deepseek-v4.1-flash \
//     node test/live.js
// 未设置 POT_LIVE_BASE 时自动跳过,适合在 CI 里安全存在。
//
// 校验点:选了「关闭思考」后,流式过程不应出现任何 "💭 思考中" 进度事件(即模型没有输出思考内容)。

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const BASE = process.env.POT_LIVE_BASE
const KEY = process.env.POT_LIVE_KEY ?? ''
const MODEL = process.env.POT_LIVE_MODEL ?? ''

if (!BASE) {
    console.log('跳过:未设置 POT_LIVE_BASE')
    process.exit(0)
}

const script = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
const translate = (() => eval(`${script} translate`))()

// 复刻 pot 注入的 tauriFetch:返回 { ok, status, data(已解析 JSON) }
async function tauriFetch(url, options = {}) {
    const init = { method: options.method ?? 'GET', headers: options.headers ?? {} }
    if (options.body?.type === 'Json') {
        init.body = JSON.stringify(options.body.payload)
    }
    const res = await fetch(url, init)
    let data = null
    try {
        data = await res.json()
    } catch {
        data = null
    }
    return { ok: res.ok, status: res.status, data }
}

globalThis.window = { fetch: globalThis.fetch }

async function run(reasoning) {
    const progress = []
    const started = Date.now()
    const value = await translate('机器学习正在改变世界,而我们必须理解它的边界与可能。', 'zh_cn', 'English', {
        config: { requestPath: BASE, apiKey: KEY, model: MODEL, reasoning, stream: 'true' },
        detect: 'zh_cn',
        setResult: (v) => progress.push(v),
        utils: { tauriFetch },
    })
    return { value, progress, seconds: (Date.now() - started) / 1000 }
}

;(async () => {
    console.log(`服务: ${BASE}\n模型: ${MODEL}\n`)

    const base = await run(undefined)
    const thinkingEvents = base.progress.filter((v) => v.startsWith('💭')).length
    console.log(`[默认(不干预)] ${base.seconds.toFixed(1)}s,思考进度事件 ${thinkingEvents} 个`)
    assert.ok(typeof base.value === 'string' && base.value.trim() !== '', '默认配置应返回译文')

    const off = await run('low')
    const offThinking = off.progress.filter((v) => v.startsWith('💭')).length
    console.log(`[关闭思考]     ${off.seconds.toFixed(1)}s,思考进度事件 ${offThinking} 个`)
    assert.ok(off.value.trim() !== '', '关闭思考也应返回译文')
    assert.strictEqual(offThinking, 0, '关闭思考后不应再产生思考内容(若失败,说明该模型不支持关闭思考)')

    const high = await run('high')
    console.log(`[深入思考]     ${high.seconds.toFixed(1)}s,思考进度事件 ${high.progress.filter((v) => v.startsWith('💭')).length} 个`)
    assert.ok(high.value.trim() !== '', '深入思考也应返回译文')

    console.log('\n✅ 联调通过:关闭思考确实生效')
})().catch((e) => {
    console.error('\n❌ 联调失败:', e?.message ?? e)
    process.exit(1)
})