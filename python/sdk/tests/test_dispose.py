"""Tests for the dispose teardown ladder."""

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _helpers import dispose as dispose_mod


async def _sleep_child():
    return await asyncio.create_subprocess_exec(
        sys.executable, '-c', 'import time; time.sleep(30)',
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL)


class DisposeTest(unittest.IsolatedAsyncioTestCase):

    async def test_disposes_running_process(self):
        proc = await _sleep_child()
        self.assertIsNone(proc.returncode)
        await dispose_mod.dispose_runtime_process(
            proc, dispose_eof_grace_ms=100, dispose_grace_ms=100)
        self.assertIsNotNone(proc.returncode)

    async def test_idempotent_on_exited_process(self):
        proc = await asyncio.create_subprocess_exec(
            sys.executable, '-c', 'pass',
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL)
        rc = await proc.wait()
        await dispose_mod.dispose_runtime_process(
            proc, dispose_eof_grace_ms=50, dispose_grace_ms=50)
        self.assertEqual(proc.returncode, rc)

    async def test_cooperative_eof(self):
        # `cat`-style child exits when stdin closes (EOF) within the grace.
        proc = await asyncio.create_subprocess_exec(
            sys.executable, '-c', 'import sys; sys.stdout.flush()',
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL)
        await dispose_mod.dispose_runtime_process(
            proc, dispose_eof_grace_ms=2000, dispose_grace_ms=100)
        self.assertIsNotNone(proc.returncode)


if __name__ == '__main__':
    unittest.main(verbosity=2)