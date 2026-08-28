/**
 * @flowforge/forgekin-app — 阶段7 F37 ForgeMind 应用层 Cordis 插件
 *
 * 挂载 `ctx.forgeMind`：ForgeMindPlugin 四钩子（F026）——
 * registerForgekins（通用 Forgekin 模板）/ registerForgeSkills（锻造技能）/
 * registerCouncilChannels（MindCouncil 通道）/ registerAutoForgeConfig
 * （F100 自我进化 Mode A/B/C）+ forgeFromTemplate 便捷锻造入口。
 *
 * TS 移植自 `forgemind/plugins.py` + `docs/features/F026-forgemind-app-layer.md`。
 * 一切皆插件：外部 *Forge 项目可通过本服务注册自己的模板/技能/通道/配置
 * （替代 Python Plugin V3 四钩子协议，Cordis 插件体系内扩展）。
 * forgemind 单向依赖核心框架层（编程红线第 10 / 12 条）。
 */
import { Context, Service } from '@flowforge/cordis';
import type { ForgePipeline } from '@flowforge/forgekin-forging';
import { ForgekinFormData, ForgekinSpecies } from '@flowforge/forgekin-species';
import {
  DEFAULT_AUTO_FORGE_CONFIGS,
  parseAutoForgeConfigs,
  type AutoForgeConfig,
} from './auto-forge.js';
import { loadAutoForgeConfig } from './config.js';
import {
  DEFAULT_COUNCIL_CHANNELS,
  type CouncilChannelDef,
} from './channels.js';
import {
  DEFAULT_FORGE_SKILLS,
  type ForgeSkill,
} from './skills.js';
import {
  DEFAULT_FORGEKIN_TEMPLATES,
  type ForgekinTemplate,
} from './templates.js';

export * from './auto-forge.js';
export * from './channels.js';
export * from './config.js';
export * from './skills.js';
export * from './templates.js';

export interface ForgeMindAppOptions {
  /** 预注入的 ForgePipeline（forgeFromTemplate 便捷入口需要；缺省抛错提示注入） */
  readonly pipeline?: ForgePipeline | undefined;
  /** 预注册的通用 Forgekin 模板（缺省内置 4 模板） */
  readonly templates?: readonly ForgekinTemplate[] | undefined;
  /** 预注册的锻造技能（缺省内置 4 技能） */
  readonly skills?: readonly ForgeSkill[] | undefined;
  /** 预注册的 MindCouncil 通道（缺省内置 2 通道） */
  readonly councilChannels?: readonly CouncilChannelDef[] | undefined;
  /** 预注册的自我进化配置（缺省内置 1 配置） */
  readonly autoForgeConfigs?: readonly AutoForgeConfig[] | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** ForgeMind 应用层：四钩子注册表 + 便捷锻造入口 */
    forgeMind: ForgeMindAppService;
  }
}

export class ForgeMindAppService extends Service {
  /** 通用 Forgekin 模板注册表（插件扩展点） */
  readonly templates: ForgekinTemplate[];
  /** 锻造技能注册表 */
  readonly skills: ForgeSkill[];
  /** MindCouncil 通道注册表 */
  readonly councilChannels: CouncilChannelDef[];
  /** 自我进化配置注册表 */
  readonly autoForgeConfigs: AutoForgeConfig[];

  private pipeline: ForgePipeline | null;

  constructor(ctx: Context, options: ForgeMindAppOptions = {}) {
    super(ctx, 'forgeMind');
    this.templates = [...(options.templates ?? DEFAULT_FORGEKIN_TEMPLATES)];
    this.skills = [...(options.skills ?? DEFAULT_FORGE_SKILLS)];
    this.councilChannels = [...(options.councilChannels ?? DEFAULT_COUNCIL_CHANNELS)];
    this.autoForgeConfigs = [...(options.autoForgeConfigs ?? DEFAULT_AUTO_FORGE_CONFIGS)];
    this.pipeline = options.pipeline ?? null;
  }

  // ── 四钩子注册（Plugin V3 → Cordis 插件扩展点）──────────────────

  /** register_forgekins：注册通用 Forgekin 模板（同名覆盖） */
  registerForgekins(...templates: ForgekinTemplate[]): void {
    for (const template of templates) {
      const idx = this.templates.findIndex((t) => t.name === template.name);
      if (idx >= 0) {
        this.templates[idx] = template;
      } else {
        this.templates.push(template);
      }
    }
  }

  /** register_forge_skills：注册锻造技能（同名覆盖） */
  registerForgeSkills(...skills: ForgeSkill[]): void {
    for (const skill of skills) {
      const idx = this.skills.findIndex((s) => s.name === skill.name);
      if (idx >= 0) {
        this.skills[idx] = skill;
      } else {
        this.skills.push(skill);
      }
    }
  }

  /** register_council_channels：注册 MindCouncil 通道（同名覆盖） */
  registerCouncilChannels(...channels: CouncilChannelDef[]): void {
    for (const channel of channels) {
      const idx = this.councilChannels.findIndex((c) => c.name === channel.name);
      if (idx >= 0) {
        this.councilChannels[idx] = channel;
      } else {
        this.councilChannels.push(channel);
      }
    }
  }

  /** register_auto_forge_config：注册自我进化配置（forgekin_id 覆盖） */
  registerAutoForgeConfig(...configs: AutoForgeConfig[]): void {
    for (const config of configs) {
      const idx = this.autoForgeConfigs.findIndex((c) => c.forgekin_id === config.forgekin_id);
      if (idx >= 0) {
        this.autoForgeConfigs[idx] = config;
      } else {
        this.autoForgeConfigs.push(config);
      }
    }
  }

  /** 从 YAML 加载自我进化配置并注册（配置驱动，铁律5+P16） */
  registerAutoForgeFromYaml(yamlPath?: string): void {
    const raw = loadAutoForgeConfig(yamlPath);
    const configs = parseAutoForgeConfigs(raw['auto_forge']);
    for (const config of configs) {
      this.registerAutoForgeConfig(config);
    }
  }

  // ── 便捷锻造入口（forge_from_template）──────────────────────────

  /**
   * 从预定义模板锻造 Forgekin 实例。
   *
   * @param templateName - 模板中的 Forgekin 名（如 "孙悟空"）。
   * @param options - namespace / operatorId / 注入 pipeline。
   * @throws 模板不存在或 pipeline 未注入时抛错。
   */
  async forgeFromTemplate(
    templateName: string,
    options: { namespace?: string | undefined; operatorId?: string | null | undefined } = {},
  ): Promise<Awaited<ReturnType<ForgePipeline['forge']>>> {
    const template = this.templates.find((t) => t.name === templateName);
    if (template === undefined) {
      const available = this.templates.map((t) => t.name).join(', ');
      throw new Error(`未找到Forgekin模板: ${templateName}（可用模板: ${available}）`);
    }
    if (this.pipeline === null) {
      throw new Error(
        'ForgePipeline 未注入——请通过 ForgeMindAppOptions.pipeline 注入 ctx.forgeForging.pipeline。',
      );
    }
    const form = new ForgekinFormData({
      name: template.name,
      species: template.species,
      namespace: options.namespace ?? 'forgemind',
      requirement: template.requirement,
      seed_params: { ...(template.extras ?? {}) },
      operator_id: options.operatorId ?? null,
    });
    return this.pipeline.forge(form);
  }

  // ── 查询门面 ─────────────────────────────────────────────────────

  /** 全部通用 Forgekin 模板 */
  listTemplates(): ForgekinTemplate[] {
    return this.templates.slice();
  }

  /** 按形态过滤模板 */
  findTemplatesBySpecies(species: ForgekinSpecies): ForgekinTemplate[] {
    return this.templates.filter((t) => t.species === species);
  }
}

export default function Plugin(ctx: Context, options?: ForgeMindAppOptions) {
  return ctx.plugin(ForgeMindAppService, options);
}
