"""Alert Manager - Alert rules and notification.

Implements FR-OBS-04: Alert rules for critical system events.
"""

import time
from typing import Optional, Dict, Any, List, Callable
from flowforge.core.tracing import get_logger

logger = get_logger("observability.alerts")


class AlertRule:
    """An alert rule definition."""

    def __init__(
        self,
        name: str,
        condition: Callable[[Dict[str, Any]], bool],
        severity: str = "warning",
        message: str = "",
        cooldown_seconds: int = 300,
    ):
        self.name = name
        self.condition = condition
        self.severity = severity
        self.message = message
        self.cooldown_seconds = cooldown_seconds
        self._last_triggered: float = 0

    def check(self, context: Dict[str, Any]) -> bool:
        """Check if the alert condition is met."""
        try:
            return self.condition(context)
        except Exception:
            return False

    def should_trigger(self, context: Dict[str, Any]) -> bool:
        """Check if alert should trigger (with cooldown)."""
        if not self.check(context):
            return False

        now = time.time()
        if now - self._last_triggered < self.cooldown_seconds:
            return False

        self._last_triggered = now
        return True


class AlertManager:
    """Alert manager with rule-based alerting.

    Evaluates alert rules against system context
    and triggers notifications when conditions are met.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self._rules: List[AlertRule] = []
        self._notifications: List[Dict[str, Any]] = []
        self._notification_callback: Optional[Callable] = None
        self._max_notifications = self.config.get("max_notifications", 100)

        # Register default alert rules
        self._register_default_rules()

    def _register_default_rules(self):
        """Register default system alert rules."""
        # High error rate
        self.add_rule(AlertRule(
            name="high_error_rate",
            condition=lambda ctx: ctx.get("error_rate", 0) > 0.5,
            severity="critical",
            message="Error rate exceeds 50%",
            cooldown_seconds=300,
        ))

        # Token budget low
        self.add_rule(AlertRule(
            name="token_budget_low",
            condition=lambda ctx: ctx.get("token_budget_remaining", 1.0) < 0.1,
            severity="warning",
            message="Token budget below 10%",
            cooldown_seconds=600,
        ))

        # Circuit breaker open
        self.add_rule(AlertRule(
            name="circuit_breaker_open",
            condition=lambda ctx: ctx.get("circuit_breaker_open", False),
            severity="critical",
            message="MCP circuit breaker is open",
            cooldown_seconds=60,
        ))

    def add_rule(self, rule: AlertRule):
        """Add an alert rule."""
        self._rules.append(rule)

    def set_notification_callback(self, callback: Callable):
        """Set the callback for alert notifications."""
        self._notification_callback = callback

    async def evaluate(self, context: Dict[str, Any]):
        """Evaluate all alert rules against the current context."""
        for rule in self._rules:
            if rule.should_trigger(context):
                alert = {
                    "rule_name": rule.name,
                    "severity": rule.severity,
                    "message": rule.message,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "context_snapshot": {k: v for k, v in context.items() if isinstance(v, (str, int, float, bool))},
                }

                self._notifications.append(alert)
                if len(self._notifications) > self._max_notifications:
                    self._notifications = self._notifications[-self._max_notifications:]

                logger.warning(f"[Alert] {rule.severity.upper()}: {rule.message}")

                if self._notification_callback:
                    try:
                        await self._notification_callback(alert)
                    except Exception as e:
                        logger.error(f"Alert notification callback failed: {e}")

    def get_alerts(self, severity: Optional[str] = None, limit: int = 20) -> List[dict]:
        """Get recent alerts, optionally filtered by severity."""
        alerts = self._notifications
        if severity:
            alerts = [a for a in alerts if a.get("severity") == severity]
        return alerts[-limit:]

    def get_status(self) -> dict:
        """Get alert manager status."""
        return {
            "rule_count": len(self._rules),
            "alert_count": len(self._notifications),
            "rules": [{"name": r.name, "severity": r.severity} for r in self._rules],
        }
