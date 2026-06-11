"""Plugin Marketplace — One-click install/uninstall for FlowForge plugins.

Inspired by Dify's marketplace model, provides a centralized registry
for discovering, installing, and managing FlowForge plugins.

Usage:

    from flowforge.core.marketplace import Marketplace

    mp = Marketplace()

    # Search for plugins
    plugins = await mp.search("web search")

    # Get plugin details
    info = await mp.get_plugin("flowforge-web-search")

    # Install a plugin
    await mp.install("flowforge-web-search", version="1.2.0")

    # Uninstall a plugin
    await mp.uninstall("flowforge-web-search")

    # List installed plugins
    installed = await mp.list_installed()

    # Update a plugin
    await mp.update("flowforge-web-search")
"""

from __future__ import annotations

import hashlib
import importlib
import json
import os
import shutil
from pathlib import Path
from typing import Any, Literal, Optional

import yaml
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("marketplace")


# ── Marketplace Plugin Manifest ──────────────────────────────────────


class PluginManifest(BaseModel):
    """Metadata descriptor for a marketplace plugin.

    This is the single source of truth for plugin discovery, versioning,
    and dependency resolution. Each plugin in the registry must provide
    a complete manifest.
    """

    name: str
    display_name: str = ""
    description: str = ""
    version: str = "1.0.0"
    author: str = ""
    category: Literal["tool", "agent", "mode", "integration", "theme"] = "tool"
    tags: list[str] = Field(default_factory=list)
    homepage: Optional[str] = None
    repository: Optional[str] = None
    license: str = "MIT"
    min_flowforge_version: Optional[str] = None
    dependencies: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    entry_point: str = ""
    checksum: Optional[str] = None


# ── Marketplace Registry ─────────────────────────────────────────────


class MarketplaceRegistry:
    """Manages the plugin registry — local YAML files or remote source.

    The registry is a collection of plugin manifests stored as YAML.
    By default, manifests are loaded from ``config/marketplace/``.
    A remote registry URL can be configured for pulling updates.
    """

    def __init__(self, registry_path: str | None = None) -> None:
        if registry_path is None:
            registry_path = str(
                Path(__file__).parent.parent / "config" / "marketplace"
            )
        self._registry_path = Path(registry_path)
        self._plugins: dict[str, PluginManifest] = {}
        self._remote_url: str | None = None
        self._loaded = False

    async def _ensure_loaded(self) -> None:
        """Lazily load the registry on first access."""
        if self._loaded:
            return
        await self._load_local_registry()
        self._loaded = True

    async def _load_local_registry(self) -> None:
        """Load all YAML files from the local registry directory."""
        if not self._registry_path.exists():
            logger.warning(
                f"Marketplace registry path not found: {self._registry_path}"
            )
            return

        yaml_files = list(self._registry_path.glob("*.yaml")) + list(
            self._registry_path.glob("*.yml")
        )
        for yaml_file in yaml_files:
            try:
                with open(yaml_file, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                plugin_list = data.get("plugins", [])
                for plugin_data in plugin_list:
                    manifest = PluginManifest(**plugin_data)
                    self._plugins[manifest.name] = manifest
                logger.info(
                    f"Loaded {len(plugin_list)} plugins from {yaml_file.name}"
                )
            except Exception as e:
                logger.error(f"Failed to load registry file {yaml_file}: {e}")

    async def search(
        self, query: str, category: str | None = None
    ) -> list[PluginManifest]:
        """Search plugins by keyword and optional category.

        Matches against name, display_name, description, and tags.
        """
        await self._ensure_loaded()
        query_lower = query.lower()
        results: list[PluginManifest] = []
        for manifest in self._plugins.values():
            if category and manifest.category != category:
                continue
            searchable = " ".join(
                [
                    manifest.name,
                    manifest.display_name,
                    manifest.description,
                    *manifest.tags,
                ]
            ).lower()
            if query_lower in searchable:
                results.append(manifest)
        return results

    async def get_plugin(self, name: str) -> Optional[PluginManifest]:
        """Get a specific plugin manifest by name."""
        await self._ensure_loaded()
        return self._plugins.get(name)

    async def list_plugins(
        self, category: str | None = None
    ) -> list[PluginManifest]:
        """List all available plugins, optionally filtered by category."""
        await self._ensure_loaded()
        if category:
            return [
                m for m in self._plugins.values() if m.category == category
            ]
        return list(self._plugins.values())

    async def refresh_registry(self) -> dict[str, Any]:
        """Refresh the registry from remote source if configured.

        Returns a summary dict with counts and status.
        """
        if not self._remote_url:
            logger.info("No remote registry configured, skipping refresh")
            return {
                "status": "skipped",
                "reason": "no_remote_configured",
                "total_plugins": len(self._plugins),
            }

        try:
            import aiohttp

            async with aiohttp.ClientSession() as session:
                async with session.get(self._remote_url) as resp:
                    if resp.status != 200:
                        return {
                            "status": "error",
                            "reason": f"HTTP {resp.status}",
                        }
                    data = await resp.json(content_type=None)

            remote_plugins = data.get("plugins", [])
            added = 0
            updated = 0
            for plugin_data in remote_plugins:
                manifest = PluginManifest(**plugin_data)
                if manifest.name in self._plugins:
                    existing = self._plugins[manifest.name]
                    if manifest.version != existing.version:
                        updated += 1
                else:
                    added += 1
                self._plugins[manifest.name] = manifest

            logger.info(
                f"Registry refreshed: {added} new, {updated} updated"
            )
            return {
                "status": "refreshed",
                "added": added,
                "updated": updated,
                "total_plugins": len(self._plugins),
            }
        except ImportError:
            logger.warning("aiohttp not installed, cannot refresh remote registry")
            return {
                "status": "error",
                "reason": "aiohttp_not_installed",
            }
        except Exception as e:
            logger.error(f"Failed to refresh remote registry: {e}")
            return {
                "status": "error",
                "reason": str(e),
            }

    def set_remote_url(self, url: str) -> None:
        """Configure a remote registry URL for refresh operations."""
        self._remote_url = url
        logger.info(f"Remote registry URL set to: {url}")


# ── Marketplace ───────────────────────────────────────────────────────


class Marketplace:
    """Main marketplace interface — discover, install, and manage plugins.

    Coordinates between the registry (discovery) and the plugin manager
    (lifecycle). Provides one-click install/uninstall with dependency
    resolution and verification.
    """

    def __init__(
        self,
        plugin_manager: Any = None,
        registry_path: str | None = None,
    ) -> None:
        self._plugin_manager = plugin_manager
        self._registry = MarketplaceRegistry(registry_path)
        self._installed: dict[str, PluginManifest] = {}
        self._plugins_dir = Path(__file__).parent.parent / "plugins"
        self._installed_manifest_path = (
            self._plugins_dir / "installed.json"
        )

    @property
    def registry(self) -> MarketplaceRegistry:
        """Access the underlying registry for advanced operations."""
        return self._registry

    async def _ensure_installed_loaded(self) -> None:
        """Load the installed plugins manifest from disk if not yet loaded."""
        if self._installed:
            return
        if self._installed_manifest_path.exists():
            try:
                with open(self._installed_manifest_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for name, manifest_data in data.items():
                    self._installed[name] = PluginManifest(**manifest_data)
            except Exception as e:
                logger.error(f"Failed to load installed manifest: {e}")

    async def _save_installed_manifest(self) -> None:
        """Persist the installed plugins manifest to disk."""
        self._plugins_dir.mkdir(parents=True, exist_ok=True)
        data = {
            name: manifest.model_dump()
            for name, manifest in self._installed.items()
        }
        with open(self._installed_manifest_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    async def search(
        self, query: str, category: str | None = None
    ) -> list[PluginManifest]:
        """Search the marketplace for plugins.

        Args:
            query: Search keyword (matched against name, description, tags).
            category: Optional category filter.

        Returns:
            List of matching plugin manifests.
        """
        return await self._registry.search(query, category)

    async def get_plugin(self, name: str) -> Optional[PluginManifest]:
        """Get detailed information about a specific plugin.

        Args:
            name: Plugin identifier (e.g., "flowforge-web-search").

        Returns:
            Plugin manifest, or None if not found.
        """
        return await self._registry.get_plugin(name)

    async def install(
        self, name: str, version: str | None = None
    ) -> dict[str, Any]:
        """Install a plugin from the marketplace.

        Performs the following steps:
        1. Look up the plugin in the registry
        2. Verify FlowForge version compatibility
        3. Resolve and install dependencies recursively
        4. Download/copy plugin files
        5. Register with PluginManager
        6. Persist installation record

        Args:
            name: Plugin identifier.
            version: Optional specific version to install (defaults to latest).

        Returns:
            Dict with installation status and details.
        """
        await self._ensure_installed_loaded()

        # 1. Look up in registry
        manifest = await self._registry.get_plugin(name)
        if manifest is None:
            return {
                "status": "error",
                "name": name,
                "error": f"Plugin '{name}' not found in registry",
            }

        # Version check
        if version and manifest.version != version:
            return {
                "status": "error",
                "name": name,
                "error": f"Version {version} not available (latest: {manifest.version})",
            }

        # Already installed?
        if name in self._installed:
            existing = self._installed[name]
            if existing.version == manifest.version:
                return {
                    "status": "already_installed",
                    "name": name,
                    "version": manifest.version,
                }

        # 2. Verify FlowForge version compatibility
        if manifest.min_flowforge_version:
            compat = await self._check_flowforge_version(
                manifest.min_flowforge_version
            )
            if not compat:
                return {
                    "status": "error",
                    "name": name,
                    "error": (
                        f"Plugin requires FlowForge >= {manifest.min_flowforge_version}"
                    ),
                }

        # 3. Resolve and install dependencies
        for dep_name in manifest.dependencies:
            if dep_name in self._installed:
                logger.info(f"Dependency '{dep_name}' already installed")
                continue
            dep_result = await self.install(dep_name)
            if dep_result.get("status") == "error":
                return {
                    "status": "error",
                    "name": name,
                    "error": f"Failed to install dependency '{dep_name}': {dep_result.get('error')}",
                }

        # 4. Verify plugin integrity (checksum)
        if manifest.checksum:
            verified = await self._verify_checksum(name, manifest.checksum)
            if not verified:
                return {
                    "status": "error",
                    "name": name,
                    "error": "Plugin checksum verification failed",
                }

        # 5. Download/copy plugin files
        plugin_dir = self._plugins_dir / name
        try:
            await self._download_plugin(manifest, plugin_dir)
        except Exception as e:
            logger.error(f"Failed to download plugin '{name}': {e}")
            return {
                "status": "error",
                "name": name,
                "error": f"Download failed: {e}",
            }

        # 6. Register with PluginManager
        if self._plugin_manager is not None:
            try:
                await self._register_with_manager(manifest, plugin_dir)
            except Exception as e:
                logger.error(f"Failed to register plugin '{name}': {e}")
                return {
                    "status": "error",
                    "name": name,
                    "error": f"Registration failed: {e}",
                }

        # 7. Persist installation record
        self._installed[name] = manifest
        await self._save_installed_manifest()

        logger.info(
            f"Plugin installed: {name} v{manifest.version}"
        )
        return {
            "status": "installed",
            "name": name,
            "version": manifest.version,
        }

    async def uninstall(self, name: str) -> dict[str, Any]:
        """Uninstall a plugin.

        Checks if other installed plugins depend on it before proceeding.
        Removes plugin files and unregisters from PluginManager.

        Args:
            name: Plugin identifier.

        Returns:
            Dict with uninstallation status.
        """
        await self._ensure_installed_loaded()

        if name not in self._installed:
            return {
                "status": "error",
                "name": name,
                "error": f"Plugin '{name}' is not installed",
            }

        # Check for dependents
        dependents = self._find_dependents(name)
        if dependents:
            return {
                "status": "error",
                "name": name,
                "error": (
                    f"Cannot uninstall: plugins {dependents} depend on it"
                ),
            }

        # Unregister from PluginManager
        if self._plugin_manager is not None:
            try:
                await self._unregister_from_manager(name)
            except Exception as e:
                logger.error(f"Failed to unregister plugin '{name}': {e}")

        # Remove plugin files
        plugin_dir = self._plugins_dir / name
        if plugin_dir.exists():
            try:
                shutil.rmtree(str(plugin_dir))
            except Exception as e:
                logger.warning(
                    f"Failed to remove plugin directory for '{name}': {e}"
                )

        # Remove from installed manifest
        del self._installed[name]
        await self._save_installed_manifest()

        logger.info(f"Plugin uninstalled: {name}")
        return {"status": "uninstalled", "name": name}

    async def list_installed(self) -> list[PluginManifest]:
        """List all currently installed plugins.

        Returns:
            List of installed plugin manifests.
        """
        await self._ensure_installed_loaded()
        return list(self._installed.values())

    async def update(self, name: str) -> dict[str, Any]:
        """Update a plugin to the latest version available in the registry.

        Args:
            name: Plugin identifier.

        Returns:
            Dict with update status and version details.
        """
        await self._ensure_installed_loaded()

        if name not in self._installed:
            return {
                "status": "error",
                "name": name,
                "error": f"Plugin '{name}' is not installed",
            }

        current = self._installed[name]
        latest = await self._registry.get_plugin(name)
        if latest is None:
            return {
                "status": "error",
                "name": name,
                "error": f"Plugin '{name}' not found in registry",
            }

        if latest.version == current.version:
            return {
                "status": "up_to_date",
                "name": name,
                "version": current.version,
            }

        # Uninstall old, then install new
        uninstall_result = await self.uninstall(name)
        if uninstall_result.get("status") != "uninstalled":
            return {
                "status": "error",
                "name": name,
                "error": f"Failed to uninstall old version: {uninstall_result.get('error')}",
            }

        install_result = await self.install(name)
        if install_result.get("status") not in ("installed", "already_installed"):
            return install_result

        logger.info(
            f"Plugin updated: {name} {current.version} -> {latest.version}"
        )
        return {
            "status": "updated",
            "name": name,
            "previous_version": current.version,
            "new_version": latest.version,
        }

    async def verify(self, name: str) -> dict[str, Any]:
        """Verify a plugin's integrity.

        Checks that the plugin files exist and the checksum matches
        the manifest.

        Args:
            name: Plugin identifier.

        Returns:
            Dict with verification results.
        """
        await self._ensure_installed_loaded()

        if name not in self._installed:
            return {
                "status": "error",
                "name": name,
                "error": f"Plugin '{name}' is not installed",
            }

        manifest = self._installed[name]
        plugin_dir = self._plugins_dir / name
        checks: dict[str, Any] = {}

        # Check files exist
        checks["files_exist"] = plugin_dir.exists()
        if not plugin_dir.exists():
            return {
                "status": "failed",
                "name": name,
                "checks": checks,
                "error": "Plugin directory not found",
            }

        # Check entry point is loadable
        if manifest.entry_point:
            checks["entry_point"] = await self._check_entry_point(
                manifest.entry_point
            )
        else:
            checks["entry_point"] = "not_specified"

        # Check checksum
        if manifest.checksum:
            checks["checksum"] = await self._verify_checksum(
                name, manifest.checksum
            )
        else:
            checks["checksum"] = "not_specified"

        # Safety scan — check for dangerous patterns
        checks["safety_scan"] = await self._safety_scan(plugin_dir)

        all_passed = all(
            v is True or v == "not_specified"
            for v in checks.values()
            if isinstance(v, (bool, str))
        )

        return {
            "status": "verified" if all_passed else "failed",
            "name": name,
            "version": manifest.version,
            "checks": checks,
        }

    # ── Internal helpers ─────────────────────────────────────────────

    def _find_dependents(self, name: str) -> list[str]:
        """Find installed plugins that depend on the given plugin."""
        dependents: list[str] = []
        for installed_name, manifest in self._installed.items():
            if name in manifest.dependencies:
                dependents.append(installed_name)
        return dependents

    async def _check_flowforge_version(
        self, min_version: str
    ) -> bool:
        """Check if current FlowForge version meets the minimum requirement."""
        try:
            from flowforge import __version__

            current = tuple(int(x) for x in __version__.split(".")[:3])
            required = tuple(int(x) for x in min_version.split(".")[:3])
            return current >= required
        except Exception:
            # If version cannot be determined, allow installation
            logger.warning(
                f"Cannot determine FlowForge version, skipping compatibility check"
            )
            return True

    async def _verify_checksum(
        self, name: str, expected_checksum: str
    ) -> bool:
        """Verify plugin files against an expected checksum."""
        plugin_dir = self._plugins_dir / name
        if not plugin_dir.exists():
            return False

        hasher = hashlib.sha256()
        for py_file in sorted(plugin_dir.rglob("*.py")):
            try:
                content = py_file.read_bytes()
                hasher.update(content)
            except Exception:
                continue

        actual = hasher.hexdigest()
        return actual == expected_checksum

    async def _download_plugin(
        self, manifest: PluginManifest, target_dir: Path
    ) -> None:
        """Download or copy plugin files to the target directory.

        For LOCAL transport plugins, copies from the entry_point module's
        location. For remote plugins, would download from the repository.
        """
        target_dir.mkdir(parents=True, exist_ok=True)

        # Try to locate the plugin module from entry_point
        if manifest.entry_point and ":" in manifest.entry_point:
            module_path = manifest.entry_point.split(":")[0]
            try:
                spec = importlib.util.find_spec(module_path)
                if spec and spec.origin:
                    source_dir = Path(spec.origin).parent
                    if source_dir.exists():
                        for py_file in source_dir.glob("*.py"):
                            shutil.copy2(
                                str(py_file), str(target_dir / py_file.name)
                            )
                        logger.info(
                            f"Copied plugin files from {source_dir} to {target_dir}"
                        )
                        return
            except (ImportError, ValueError):
                pass

        # Fallback: create a stub __init__.py so the directory exists
        init_file = target_dir / "__init__.py"
        if not init_file.exists():
            init_file.write_text(
                f'"""Plugin: {manifest.name} v{manifest.version}"""\n',
                encoding="utf-8",
            )
        logger.info(f"Created plugin stub at {target_dir}")

    async def _register_with_manager(
        self, manifest: PluginManifest, plugin_dir: Path
    ) -> None:
        """Register the plugin with the PluginManager."""
        if self._plugin_manager is None:
            return

        if hasattr(self._plugin_manager, "install_plugin"):
            # PluginManager supports pip-based install
            self._plugin_manager.install_plugin(manifest.name)
        elif hasattr(self._plugin_manager, "_installed_plugins"):
            # Direct registration with PluginManager's internal dict
            self._plugin_manager._installed_plugins[manifest.name] = {
                "name": manifest.name,
                "entry_point": manifest.entry_point,
                "source": "marketplace",
                "version": manifest.version,
                "category": manifest.category,
            }

    async def _unregister_from_manager(self, name: str) -> None:
        """Unregister the plugin from the PluginManager."""
        if self._plugin_manager is None:
            return

        if hasattr(self._plugin_manager, "_installed_plugins"):
            self._plugin_manager._installed_plugins.pop(name, None)

    async def _check_entry_point(self, entry_point: str) -> bool:
        """Check if an entry point is importable."""
        if ":" not in entry_point:
            return False
        module_path = entry_point.split(":")[0]
        try:
            importlib.import_module(module_path)
            return True
        except ImportError:
            return False

    async def _safety_scan(self, plugin_dir: Path) -> bool:
        """Scan plugin files for potentially dangerous patterns.

        Checks for common security anti-patterns like eval(), exec(),
        subprocess without restrictions, etc.
        """
        dangerous_patterns = [
            "eval(",
            "exec(",
            "os.system(",
            "subprocess.call(",
            "subprocess.Popen(",
            "__import__(",
        ]
        for py_file in plugin_dir.rglob("*.py"):
            try:
                content = py_file.read_text(encoding="utf-8")
                for pattern in dangerous_patterns:
                    if pattern in content:
                        logger.warning(
                            f"Safety scan: found '{pattern}' in {py_file.name}"
                        )
                        return False
            except Exception:
                continue
        return True
