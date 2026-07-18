"""临时脚本：把 clowder-ai-deep-review.md 内容追加到 review.md 第十四章，并升级到 v1.4"""
from pathlib import Path

review_path = Path(r'd:\software\openclaw\flowforge\docs\review\review.md')
deep_review_path = Path(r'd:\software\openclaw\flowforge\docs\review\clowder-ai-deep-review.md')

# 读取两个文件
review_content = review_path.read_text(encoding='utf-8')
deep_content = deep_review_path.read_text(encoding='utf-8')

# 替换 review.md 末尾的 v1.3 文档状态为 v1.4
old_status = '> **文档状态**: ✅ 终稿 v1.3 已完成——追加第十三章 clowder-ai/docs 深度补审意见（21 项 CL-001~CL-021），覆盖 F100 自我进化三模式 / F093 世界引擎三层架构 / F241 Agent Provider Plugin / ADR-021 Pack 系统。待 operator 审核 21 项补审意见后，开始按 P0 优先级补全 ADR 与 Feature 规格。'

new_status = '> **文档状态**: ✅ 终稿 v1.4 已完成——追加第十四章 clowder-ai/docs 深度补审 II（20 项 CL-022~CL-041），覆盖 Plugin Framework / TeamAct Queue Steer / Event Memory / Agent Swarm / Approval Hub / QC Loop / Auto Dream / MCP 治理 / CI/CD 去重 等 9 类工程实践。第十三章（CL-001~CL-021）+ 第十四章（CL-022~CL-041）合起来构成 v7.1 从"概念框架"走向"工程实现"的完整路线图。'

if old_status in review_content:
    review_content = review_content.replace(old_status, new_status)
    print("✅ 已替换文档状态 v1.3 → v1.4")
else:
    print("⚠️ 未找到 v1.3 文档状态标注，可能已替换或格式不同")
    # 尝试部分匹配
    if 'v1.3 已完成' in review_content:
        print("  发现 'v1.3 已完成' 字符串，但完整状态行不匹配")

# 在 review.md 末尾追加第十四章
# deep_content 的头部是 "# clowder-ai 深度补审 — 20 条 CL-022~CL-041"
# 我需要把它改为 "## 第十四章：clowder-ai/docs 深度补审 II（新增 20 项，CL-022~CL-041）"

# 替换 deep_content 的头部
old_header = '# clowder-ai 深度补审 — 20 条 CL-022~CL-041'
new_header = '## 第十四章：clowder-ai/docs 深度补审 II（新增 20 项，CL-022~CL-041）'

if old_header in deep_content:
    deep_content = deep_content.replace(old_header, new_header, 1)
    print("✅ 已替换 deep_review 头部为第十四章格式")
else:
    print("⚠️ 未找到 deep_review 头部，直接追加")

# 在 review.md 末尾追加 deep_content
# review.md 末尾是 "...下一步将按 6.11 节实施路径修改 spec.md / arch.md / design.md / rules.md / prompts.md 等文档。"
# 我需要在这之后追加 "---" + deep_content

# 找到 review.md 末尾的最后一个 "---"
# 直接追加
appendix = '\n\n---\n\n' + deep_content

review_content = review_content + appendix

# 写入 review.md
review_path.write_text(review_content, encoding='utf-8')
print(f"✅ 已追加第十四章到 review.md")
print(f"   review.md 新大小: {len(review_content)} 字符")
print(f"   deep_review.md 大小: {len(deep_content)} 字符")
