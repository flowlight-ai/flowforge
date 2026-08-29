/**
 * Install Policy — F146 安装策略评估：信任等级 + 安装脚本门禁。
 *
 * 移植自 clowder-ai `config/capabilities/install-policy.ts`。
 */

import { DEFAULT_INSTALL_POLICY, type InstallPolicy, type PolicyEvaluation, type TrustLevel } from '@flowforge/cats-shared';

interface PolicyInput {
  trustLevel?: TrustLevel;
  hasInstallScripts?: boolean;
  userConfirmed?: boolean;
  scriptsApproved?: boolean;
}

export function evaluateInstallPolicy(
  input: PolicyInput,
  policy: InstallPolicy = DEFAULT_INSTALL_POLICY,
): PolicyEvaluation {
  const confirmations: string[] = [];

  const trustAllowed = input.trustLevel != null && policy.autoInstallTrustLevels.includes(input.trustLevel);
  if (!trustAllowed && !input.userConfirmed) {
    confirmations.push('community_trust');
  }

  const scriptsAllowed = !input.hasInstallScripts || !policy.denyInstallScripts;
  if (!scriptsAllowed && !input.scriptsApproved) {
    confirmations.push('install_scripts');
  }

  if (confirmations.length === 0) {
    return { allowed: true };
  }

  const reason = confirmations.includes('install_scripts')
    ? 'install_scripts_denied'
    : 'community_requires_confirmation';

  return {
    allowed: false,
    reason,
    requiredConfirmations: confirmations,
  };
}
