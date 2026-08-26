/**
 * @flowforge/external-agent prompt-config-map — 提示词配置映射。
 *
 * TS 重写自 flowforge/core/external_agent/prompt_config_map.py：
 *   - PromptConfig: prompt_key / role_description / personality_summary /
 *     value_anchors / restrictions / extra_yaml_path
 *   - PromptConfigMap: registerMapping / getMapping / listMappings /
 *     removeMapping / resolvePrompt（Role + Personality + Value Anchors +
 *     Restrictions + Extra Config 拼接）
 */

/** 提示词配置（prompt_config_map.py PromptConfig）。 */
export interface PromptConfig {
  /** 提示词键。 */
  readonly prompt_key: string;
  /** 角色描述。 */
  readonly role_description: string;
  /** 性格摘要。 */
  readonly personality_summary?: string;
  /** 价值锚点列表。 */
  readonly value_anchors?: readonly string[];
  /** 限制列表。 */
  readonly restrictions?: readonly string[];
  /** 额外 YAML 配置路径。 */
  readonly extra_yaml_path?: string;
}

/** 提示词配置映射（prompt_config_map.py PromptConfigMap）。 */
export class PromptConfigMap {
  private readonly _mappings = new Map<string, PromptConfig>();

  /** 注册映射（同 key 覆盖）。 */
  registerMapping(config: PromptConfig): void {
    this._mappings.set(config.prompt_key, config);
  }

  /** 获取映射（未注册返回 undefined）。 */
  getMapping(promptKey: string): PromptConfig | undefined {
    return this._mappings.get(promptKey);
  }

  /** 列出全部映射（按注册顺序）。 */
  listMappings(): PromptConfig[] {
    return [...this._mappings.values()];
  }

  /** 移除映射（返回是否曾存在）。 */
  removeMapping(promptKey: string): boolean {
    return this._mappings.delete(promptKey);
  }

  /**
   * 解析提示词（prompt_config_map.py resolve_prompt）：
   *
   *   # Role
   *   {role_description}
   *   [Personality] {personality_summary}
   *   [Value Anchors] {anchors joined by '; '}
   *   [Restrictions] {restrictions joined by '; '}
   *   [Extra Config] {extra_yaml_path}
   */
  resolvePrompt(
    promptKey: string,
    context: Record<string, unknown> = {},
  ): string {
    const config = this._mappings.get(promptKey);
    if (!config) {
      throw new Error(`prompt not registered: ${promptKey}`);
    }
    const sections: string[] = [`# Role\n${config.role_description}`];
    if (config.personality_summary) {
      sections.push(`[Personality] ${config.personality_summary}`);
    }
    if (config.value_anchors && config.value_anchors.length > 0) {
      sections.push(`[Value Anchors] ${config.value_anchors.join('; ')}`);
    }
    if (config.restrictions && config.restrictions.length > 0) {
      sections.push(`[Restrictions] ${config.restrictions.join('; ')}`);
    }
    if (config.extra_yaml_path) {
      sections.push(`[Extra Config] ${config.extra_yaml_path}`);
    }
    let prompt = sections.join('\n');
    // 简单模板渲染（{{key}} 占位符）
    for (const [key, value] of Object.entries(context)) {
      prompt = prompt.replaceAll(`{{${key}}}`, String(value));
    }
    return prompt;
  }
}
