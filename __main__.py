"""flowforge.__main__ — `python -m flowforge` 入口.

委托给 flowforge.cli.__main__.main。
"""

from __future__ import annotations

import sys

from flowforge.cli.__main__ import main

if __name__ == "__main__":
    sys.exit(main())