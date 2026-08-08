# HicLaw 模板（HL1-HL6）

> **本文件内容**：HicLaw（旧系统主控框架）专用提示词模板
> **适用项目**：HicLaw
> **关键目录**：hiclaw/

---

## 9.1 平台适配

### HL1 Win11适配

```
之前只支持linux版本运行，请在win11下测试验证hiclaw/test下的所有测试用例。
如果不可用，请给hiclaw和content两个项目做最小化修改适配win11，
不要影响linux的代码。依赖的opensieve服务当前运行在docker容器中。
除了这两个目录外，不允许修改其他目录下的代码。
```

### HL2 全量测试

```
运行hiclaw/test下的所有测试用例（共13个测试文件，数百个组合场景）：
test_doubao_proxy.py, test_article_e2e.py, _test_openclaw_fix.py,
test_full_pipeline.py, test_material_fetcher.py, test_publish.py,
test_series_e2e.py, test_interact.py, test_video_e2e.py,
test_weitoutiao.py, test_clear_cache.py, test_file_cleanup.py,
test_helixrag.py
汇总测试报告给我。
```

---

## 9.2 模型管理

### HL3 模型管理工具验证

```
请验证HicLaw的模型管理工具集：
1. fetch_models.py — 从10个供应商并发获取模型列表
2. merge_to_openclaw.py — 合并模型配置 + 多维评分排序
3. auto_fix_models.py — 自动修复不可用模型（5分钟crontab）
4. health_checker.py — 模型健康检查
5. model_assignment.json — 差异化模型分配（auto/fixed两种模式）
6. 验证评分维度：供应商等级/模型系列/参数规模/上下文长度/新鲜度/免费降权/Web加权
```

---

## 9.3 消息渠道

### HL4 消息渠道插件验证

```
请验证HicLaw的消息渠道插件：
1. QQ机器人插件(openclaw-qqbot)：频道消息收发、定时提醒、富媒体
2. 微信机器人插件(openclaw-weixin)：消息收发、CDN上传、SILK转码、扫码登录
3. 验证消息加解密和Token管理
4. 验证多账号场景下的消息路由
```

---

## 9.4 Content创作引擎

### HL5 Content创作引擎验证

```
请验证openclaw_pkg的Content创作引擎：
1. content 综合创作（已合并 education/life/novel/dev/student 场景，统一通过 persona 配置区分）
2. 全流程：热榜采集→选题生成→素材搜索→文章生成→润色→引用核查→去重→封面→发布
3. 微头条发布（200-500字短内容）
4. 视频发布（FFmpeg + edge-tts + 字幕烧录）
5. 系列文章（大纲规划→审核→逐集创作→补发/重写）
6. 平台互动（自动浏览推荐、点赞、评论）
7. 定时任务（14个，每日约47篇文章）
8. 验证合规红线和去AI味规则
```

### HL6 测试性能与稳定性验证

```
验证test_full_pipeline.py：
1. 完整流程是否在5分钟内完成（不是30分钟）
2. 是否有卡死问题（增加详细logger.info）
3. Win11下是否正常运行
4. 发布完成后浏览器处理（Win11关闭浏览器，Linux只关闭tab）
```
