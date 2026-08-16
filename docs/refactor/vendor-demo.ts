// vendor-demo.ts —— 放在 docs/refactor/ 下，从项目根目录运行： npx tsx docs/refactor/vendor-demo.ts
// 直接 import 项目里 vendor/ 那份真实的 cordis，无需安装任何包。
// 需要 Node 22+ 与 tsx（npx tsx 会自动处理 .ts 扩展名导入）。
import { Context, Service } from '../../vendor/cordis/src/index.ts'

// ① 定义一个"设施(Service)"：一个会报时的服务
class ClockService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'clock')   // 设施名叫 'clock'；构造即自动注册成 ctx.clock
  }
  now() {
    return new Date().toLocaleTimeString()
  }
}

// ② 写一个插件：入驻办公室，使用 clock、监听事件、登记一个要清理的定时器
const myPlugin = (ctx: Context) => {
  console.log('[插件] 开始加载...')

  // 提供设施（构造即注册 ctx.clock）
  new ClockService(ctx)

  // 监听事件：有人说话就回应（这个监听器本身是一个 effect，卸载自动移除）
  ctx.on('user/say', (name: string, text: string) => {
    console.log(`[插件] 收到 ${name} 说: "${text}"  （此时钟: ${ctx.clock.now()}）`)
  })

  // 登记一个需要清理的"副作用(副作用/effect)"：开一个定时器
  ctx.effect(() => {
    const timer = setInterval(() => console.log('[定时器] tick'), 500)
    console.log('[插件] 已开启定时器')
    return () => {                       // ← 归还函数(dispose)
      clearInterval(timer)
      console.log('[插件] 定时器已清理 ✅')
    }
  })

  console.log('[插件] 加载完成 ✅')
}

async function main() {
  const ctx = new Context()              // 开办公室

  // ③ 入驻插件（返回值可 await，等它真正就绪）
  const fiber = ctx.plugin(myPlugin)
  await fiber

  // ④ 发个事件，看看插件有没有响应
  ctx.emit('user/say', '小明', '大家好')

  console.log('\n--- 2 秒后我们把这个插件卸载 ---')
  await new Promise(r => setTimeout(r, 2000))

  // ⑤ 卸载插件：cordis 自动逆序清理（定时器被关掉、监听器被移除）
  ctx.registry.delete(myPlugin)
  await new Promise(r => setTimeout(r, 100))  // 等异步清理 flush 完

  console.log('\n--- 卸载后再发事件，应该没人响应（监听器已随插件带走）---')
  ctx.emit('user/say', '小红', '还在吗？')
}

main()
