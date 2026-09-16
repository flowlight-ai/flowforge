"""flowforge.__main__ — `python -m flowforge` 入口.

委托给 flowforge.cli.__main__.main。

!! S11.1 冻结期横幅（阶段 11 Python 日落）!!
默认入口已切换为 TS 栈（`pnpm start`），本 Python 入口仅作回退/只读使用，
只接受 P0 修复，不开发新功能。详见 README "Python 旧版回退" 章节。
"""

from __future__ import annotations

import sys

from flowforge.cli.__main__ import main

if __name__ == "__main__":
    print(
        "FlowForge [DEPRECATED]: Python 版本已冻结（S11.1），请使用 `pnpm start` "
        "(FlowForge 0.2.0 TS)。本入口仅回退/只读。",
        file=sys.stderr,
    )
    sys.exit(main())