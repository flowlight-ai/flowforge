# p542-web-profile-boot 验证证据（verification）

> 铁律：没有新鲜的验证证据，就没有完成宣称（⑩）。
### [2026-09-19T05:55:09.186Z] node --import tsx/esm apps/cli/src/bin.ts --profile web --dump-config
- **命令**：`node --import tsx/esm apps/cli/src/bin.ts --profile web --dump-config`
- **退出码**：0
- **输出摘要**：第一层根因已消除：web profile 由 cannot resolve profile bundle 变为 exit 0 正常输出组合配置
- **结论**：通过### [2026-09-19T05:55:09.475Z] ls apps/cli/node_modules/@flowforge/web-app
- **命令**：`ls apps/cli/node_modules/@flowforge/web-app`
- **退出码**：0
- **输出摘要**：in-box bundle 已在安装目录建立链接（apps/cli/node_modules/@flowforge/web-app）
- **结论**：通过