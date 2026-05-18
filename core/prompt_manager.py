import os
import yaml
from flowforge.core.tracing import get_logger

logger = get_logger("prompt_manager")

_DEFAULT_PROMPTS = {
    "react.system": "你是一个使用ReAct模式的智能助手。你需要完成以下任务，通过思考和调用工具逐步解决。\n\n## 核心规则\n\n1. 仔细分析当前观察结果，思考下一步该做什么\n2. 如果需要调用工具，输出JSON格式的动作: {{\"tool\": \"工具名\", \"params\": {{...}}}}\n3. 如果已有足够信息回答问题，以\"最终回答：\"开头直接给出最终答案\n4. 不要重复调用同一个工具获取相同的信息\n5. 最多进行5轮思考-行动循环，如果信息仍不足，基于已有信息给出最佳回答\n\n## 原始任务\n\n{task}\n\n请根据以上任务和当前观察，思考下一步行动。",
    "react.orchestrator": "你是一个智能AI助手，拥有以下可用的工具和Agent。你可以通过调用它们来完成复杂任务。\n\n## 可用工具和Agent\n\n{tool_descriptions}\n\n## 核心规则\n\n1. 当需要使用工具或Agent时，通过 function calling 调用它们\n2. 你可以在一轮中调用多个工具（如果它们之间没有依赖关系）\n3. 收到工具返回结果后，分析结果并决定下一步行动\n4. 如果当前信息不足以完成任务，继续调用工具获取更多信息\n5. 当你已经有足够信息回答用户时，直接给出最终回复，不再调用工具\n6. 每次调用工具时，提供清晰、具体的参数\n7. 最多调用5次工具，如果信息仍不足，基于已有信息给出最佳回答",
    "planning.system": "你是一个智能任务规划助手。分析用户需求，判断任务类型和复杂度。\n\n## 可用工具和Agent\n\n{tool_descriptions}\n\n## 输出格式\n\n返回JSON格式的执行计划（不要包含markdown代码块标记）：\n{{\n    \"intent_type\": \"任务类型(search/write/code/research/chat/analyze)\",\n    \"complexity\": \"simple/medium/complex\",\n    \"summary\": \"一句话描述任务\",\n    \"plan\": [\n        {{\"step\": \"步骤名\", \"agent\": \"agent名或null\", \"tool\": \"tool名或null\", \"description\": \"步骤描述\"}}\n    ]\n}}\n\n## 规则\n- 简单对话(complexity=simple)时plan留空，直接回答即可\n- 复杂任务需要拆分为多个步骤，每步指定agent或tool\n- 搜索类任务使用web_search_agent\n- 写作类任务使用article_writing agent\n- 研究类任务使用research_agent\n- 代码类任务使用code_writer_agent",
    "planning.text_based": "你是一个智能任务执行助手。根据用户需求，制定执行计划。\n\n可用Agent和工具：\n{tool_descriptions}\n\n用户需求：{intent}\n\n请制定执行计划，输出JSON格式（不要包含markdown代码块标记）：\n{{\n    \"steps\": [\n        {{\"step\": \"步骤名\", \"agent\": \"agent名或tool名\", \"description\": \"描述\", \"params\": {{\"参数名\": \"参数值\"}}}}\n    ]\n}}\n\n规则：\n- 搜索类任务使用web_search_agent或web_search\n- 写作类任务使用article_writing\n- 研究类任务使用research_agent\n- 代码类任务使用code_writer_agent\n- 每步必须指定agent/tool名和具体参数",
    "response.solo": "你是一个专业的内容创作AI助手。根据执行过程中收集的信息，完成用户的任务。\n\n用户需求：{intent}\n\n执行过程中收集的信息：\n{collected_context}\n\n请基于以上信息，给出完整、高质量的回复。如果信息不足，可以结合你的知识补充。",
    "response.normal": "你是一个专业的内容创作助手。用户会明确指定工作流程和步骤，你需要严格按照用户的指示逐步执行。",
    "response.simple": "你是一个专业、友好的AI助手。请直接回答用户的问题。",
    "reflexion.actor": "你是一个专业的内容创作助手。请根据任务要求生成高质量输出。",
    "reflexion.evaluator": "评估以下输出质量，给出 0-1 分数和问题列表。严格输出 JSON: {{\"score\": 0.85, \"issues\": [\"问题1\", \"问题2\"]}}\n\n输出内容: {output}",
    "reflexion.reflector": "分析以下失败案例，总结失败原因和具体改进建议。输出 JSON: {{\"reflection\": \"分析结果...\"}}\n\n输出内容: {output}\n问题列表: {issues}",
    "agent.topic_research": "你是一个选题研究专家。请为以下主题生成5个有价值的选题角度。\n严格输出JSON数组: [{{\"title\": \"选题标题\", \"angle\": \"切入角度\", \"url\": \"\"}}]\n主题: {query}",
    "agent.article_writing": "你是一位专业作家。根据以下主题和素材创作一篇高质量文章。\n主题: {topic}\n素材: {materials}",
    "agent.seo_planning": "你是一个SEO专家。分析以下文章，制定SEO优化策略。\n主题: {topic}\n已有关键词: {keywords}\n文章前500字: {draft_preview}\n\n输出JSON: {{\"suggested_keywords\": [\"关键词1\", \"关键词2\"], \"title_strategy\": \"标题优化策略\", \"content_strategy\": \"内容优化策略\"}}",
    "agent.seo_optimize": "你是一个SEO专家。请优化以下文章的标题和内容结构。\n目标关键词: {keywords}\n文章内容:\n{draft}\n\n要求:\n1. 生成一个吸引人的SEO标题（包含核心关键词）\n2. 优化文章结构，合理植入关键词\n3. 添加合适的标题层级\n\n先输出一行SEO标题（不加#号），然后空一行，再输出优化后的完整Markdown文章。",
    "agent.fact_check": "你是一个事实核查专家。请检查以下文章中的事实性错误、逻辑矛盾和可疑声明。\n严格输出JSON: {{\"issues\": [\"问题1\"], \"is_clean\": true/false}}\n\n文章:\n{draft}",
    "agent.content_audit.assess": "你是一个内容审核专家。请从以下维度评估文章质量:\n1. 内容准确性 (0-10)\n2. 逻辑连贯性 (0-10)\n3. 语言表达 (0-10)\n4. 信息价值 (0-10)\n5. 可读性 (0-10)\n\n严格输出JSON: {{\"accuracy\": 8, \"coherence\": 7, \"expression\": 8, \"value\": 7, \"readability\": 8, \"issues\": [\"问题1\"], \"suggestions\": [\"建议1\"]}}\n\n文章内容:\n{draft}",
    "agent.content_audit.compliance": "检查以下文章是否包含违规内容（政治敏感、虚假信息、侵权等）。\n输出JSON: {{\"is_clean\": true, \"violations\": []}}\n\n文章:\n{draft}",
    "agent.article_eval": "评估以下文章质量（0-1分），列出问题。严格输出JSON: {{\"score\": 0.85, \"issues\": [\"问题1\"]}}\n\n文章: {draft}",
    "agent.article_reflect": "分析以下文章的不足，给出具体改进建议。输出JSON: {{\"reflection\": \"改进建议...\"}}\n文章: {draft}\n问题: {issues}",
    "tool.web_search_fallback": "你是一个搜索助手。请为以下查询生成{max_results}条搜索结果。\n严格输出JSON数组: [{{\"title\": \"标题\", \"url\": \"https://...\", \"content\": \"摘要内容\"}}]\n查询: {query}",
    "agent.headline_analyze": "分析以下文章主题的目标受众、情感基调和传播特征，为标题优化提供方向。严格输出JSON: {{\"audience\": \"...\", \"tone\": \"...\", \"hooks\": [\"...\"]}}\n主题: {topic}\n原标题: {title}",
    "agent.headline_generate": "为以下文章生成 5 个优化标题候选，目标是提高点击率。\n主题: {topic}\n原标题: {original_title}\n目标受众: {audience}\n可用钩子: {hooks}\n严格输出JSON: {{\"headlines\": [\"标题1\", \"标题2\", \"标题3\", \"标题4\", \"标题5\"]}}",
    "agent.headline_evaluate": "评估以下标题的点击率潜力，按预估点击率从高到低排序，并给出1-10的评分。\n严格输出JSON: {{\"ranked\": [{{\"headline\": \"...\", \"score\": 9}}, ...]}}\n\n标题列表:\n{headlines}",
    "agent.repurposer_analyze": "分析以下文章的核心信息、风格特征和关键要点，为多平台改写提供依据。\n严格输出JSON: {{\"core_message\": \"...\", \"style\": \"...\", \"key_points\": [\"...\"], \"tone\": \"...\"}}\n\n原文:\n{draft}",
    "agent.repurposer_rewrite": "将以下文章改写为适合{spec}的版本，保持核心信息不变。\n核心信息: {core_message}\n关键要点: {key_points}\n原文语气: {tone}\n\n原文:\n{draft}",
    "agent.multilingual_detect": "检测以下文本的语言。严格输出JSON: {{\"source_lang\": \"语言代码\", \"source_lang_name\": \"语言名称\", \"confidence\": 0.95}}\n\n文本:\n{text}",
    "agent.multilingual_translate": "将以下{source_lang}文本翻译为{target_lang}，保持原文风格、语气和专业术语的准确性。注意本地化适配，确保译文自然流畅。\n\n原文:\n{text}",
    "agent.multilingual_verify": "验证以下翻译的质量。检查：1)是否遗漏原文关键信息 2)是否有语法错误 3)是否自然流畅。\n如果翻译质量合格，输出原文翻译内容；如果需要修正，输出修正后的翻译。\n严格输出JSON: {{\"verified_translation\": \"修正后的翻译\", \"quality_score\": 9, \"issues\": [\"问题\"]}}\n\n原文({source_lang}):\n{source_text}\n\n译文({target_lang}):\n{translated_text}",
    "agent.code_analyze": "分析以下{language}编程需求，设计解决方案。严格输出JSON: {{\"modules\": [\"模块1\"], \"algorithm\": \"算法描述\", \"edge_cases\": [\"边界情况\"], \"dependencies\": [\"依赖\"]}}\n\n需求: {requirements}",
    "agent.code_generate": "你是一位资深{language}开发者。根据需求生成高质量、可运行的{language}代码。\n只输出代码本身，不要包含解释文字或markdown代码块标记。\n需求: {requirements}{design}",
    "agent.code_review": "审查以下{language}代码的质量，检查：1)是否满足需求 2)是否有bug 3)是否有安全问题 4)是否可优化。\n严格输出JSON: {{\"approved\": true/false, \"issues\": [\"问题\"], \"suggestions\": [\"建议\"]}}\n\n需求: {requirements}\n\n代码:\n{code}",
    "agent.research_plan": "为以下研究主题制定检索计划，确定需要搜索的关键角度和子问题。\n严格输出JSON: {{\"sub_queries\": [\"子查询1\", \"子查询2\"], \"angles\": [\"研究角度1\"], \"priority_topics\": [\"优先主题\"]}}\n\n主题: {topic}\n深度: {depth}",
    "agent.research_synthesize": "你是一位专业研究员。根据以下检索到的资料，对主题进行深度分析。\n主题: {topic}\n研究角度: {angles}\n\n检索资料:\n{search_results}\n\n{depth_instruction}",
    "agent.trend_collect": "列出{domain}领域当前的5个热点话题，包含标题和简述。严格输出JSON: {{\"trends\": [{{\"title\": \"...\", \"snippet\": \"...\"}}]}}",
    "agent.trend_analyze": "分析以下{domain}领域的热点数据，评估每个话题的热度、趋势方向和传播潜力。\n严格输出JSON: {{\"trends\": [{{\"title\": \"话题\", \"heat\": 85, \"direction\": \"上升/平稳/下降\", \"potential\": \"高/中/低\", \"analysis\": \"简析\"}}]}}\n\n热点数据:\n{data}",
    "agent.image_filter": "评估以下为「{topic}」搜索到的配图候选，筛选出与主题最相关、质量最高的图片。\n严格输出JSON: {{\"selected\": [{{\"title\": \"...\", \"url\": \"...\", \"relevance\": 9, \"reason\": \"选择理由\"}}]}}\n\n候选图片:\n{images}",
    "agent.web_search_plan": "优化以下搜索查询，使其更精准。可以为每个查询生成1-2个变体以提高召回率。\n严格输出JSON: {{\"optimized_queries\": [\"优化后的查询1\", \"优化后的查询2\"], \"strategy\": \"搜索策略说明\"}}\n\n原始查询: {query}",
    "agent.web_search_summarize": "对以下搜索结果进行去重和摘要整理，合并重复信息，保留最有价值的结果。\n严格输出JSON: {{\"results\": [{{\"title\": \"...\", \"url\": \"...\", \"snippet\": \"摘要\"}}]}}\n\n原始结果:\n{results}",
}


class PromptManager:
    _instance = None
    _prompts: dict = {}

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, prompts_dir: str = None):
        if self._prompts:
            return
        self._prompts = dict(_DEFAULT_PROMPTS)
        if prompts_dir and os.path.isdir(prompts_dir):
            self._load_from_dir(prompts_dir)

    def _load_from_dir(self, prompts_dir: str):
        for filename in os.listdir(prompts_dir):
            if filename.endswith((".yaml", ".yml")):
                filepath = os.path.join(prompts_dir, filename)
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        data = yaml.safe_load(f)
                    if isinstance(data, dict):
                        self._prompts.update(data)
                        logger.info(f"Loaded prompts from {filepath}: {list(data.keys())}")
                except Exception as e:
                    logger.warning(f"Failed to load prompts from {filepath}: {e}")

    def get(self, key: str, **kwargs) -> str:
        template = self._prompts.get(key, "")
        if not template:
            logger.warning(f"Prompt key '{key}' not found")
            return ""
        if kwargs:
            try:
                return template.format(**kwargs)
            except (KeyError, ValueError, IndexError) as e:
                logger.warning(f"Prompt '{key}' format error: {e}")
                for k, v in kwargs.items():
                    template = template.replace(f"{{{k}}}", str(v))
                return template
        return template

    def set(self, key: str, template: str):
        self._prompts[key] = template

    def list_keys(self) -> list:
        return list(self._prompts.keys())

    def reload(self, prompts_dir: str = None):
        self._prompts = dict(_DEFAULT_PROMPTS)
        if prompts_dir:
            self._load_from_dir(prompts_dir)


def get_prompt(key: str, **kwargs) -> str:
    return PromptManager().get(key, **kwargs)
