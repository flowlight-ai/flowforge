"""Check env vars referenced in plugins.yaml."""
import os
import re

with open("flowforge/config/plugins.yaml", "r", encoding="utf-8") as f:
    content = f.read()

pattern = r"\$\{([^}:]+)(?::([^}]*))?\}"
matches = re.findall(pattern, content)

print("Environment variables in plugins.yaml:")
for env_name, default in matches:
    actual = os.environ.get(env_name, "<NOT SET>")
    resolved = actual if env_name in os.environ else default
    status = "OK" if resolved else "EMPTY"
    print(f"  {env_name}: default={default!r}, actual={actual!r}, resolved={resolved!r} [{status}]")
