"""A2A Channel Adapters — multi-platform message bridge.

This subpackage contains platform-specific adapters that translate
between external messaging platforms (Feishu, GitHub, console) and the
A2A protocol. Each adapter implements the ``ChannelAdapter`` ABC defined
in ``base.py``.
"""

from flowforge.a2a.channels.base import ChannelAdapter

__all__ = ["ChannelAdapter"]
