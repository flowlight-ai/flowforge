# p544-build-graph 验证证据（verification）

> 铁律：没有新鲜的验证证据，就没有完成宣称（⑩）。
### [2026-09-19T09:50:59.247Z] npx tsdown --env.FF_BUILD_FACE host
- **命令**：`npx tsdown --env.FF_BUILD_FACE host`
- **退出码**：0
- **输出摘要**：打包图派生自构建图后，bundler 由 Cannot find entry 失败转为 exit 0（37s）
- **结论**：通过### [2026-09-19T09:50:59.487Z] pnpm build
- **命令**：`pnpm build`
- **退出码**：0
- **输出摘要**：build 脚本解耦后 pnpm build 由短路失败转为 exit 0（53s）并产出 lib/index.js
- **结论**：通过