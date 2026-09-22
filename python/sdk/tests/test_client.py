"""Tests for HarnessClient, driving a fake runtime subprocess over stdio."""

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _helpers import (FAKE_RUNTIME, HarnessClient, SdkProtocolError,
                      TransportClosedError, fake_runtime_env)

LATENCY = 0.01


async def new_client(config=None):
    return HarnessClient(sys.executable, [FAKE_RUNTIME], env=fake_runtime_env(config))


class HarnessClientTest(unittest.IsolatedAsyncioTestCase):

    async def _spawn(self, config=None):
        c = await new_client(config)
        await c.start()
        return c

    async def _teardown(self, c):
        if c is not None:
            try:
                await c.close()
            except Exception:  # noqa: BLE001
                pass

    async def test_initialize_returns_server_info(self):
        c = await self._spawn()
        try:
            result = await c.initialize({'cwd': '.', 'provider': 'p', 'model': 'm'})
            self.assertEqual(result['serverInfo']['name'], 'flowforge-sdk-runtime')
            self.assertIsInstance(result['serverInfo']['version'], str)
        finally:
            await self._teardown(c)

    async def test_initialize_malformed_raises_protocol_error(self):
        c = await self._spawn({'malformed': True})
        try:
            with self.assertRaises(SdkProtocolError):
                await c.initialize({'cwd': '.', 'provider': 'p', 'model': 'm'})
        finally:
            await self._teardown(c)

    async def test_prompt_returns_message_id(self):
        c = await self._spawn()
        try:
            await c.initialize({'cwd': '.', 'provider': 'p', 'model': 'm'})
            message_id = await c.prompt('sess-1', [{'type': 'text', 'text': 'hi'}])
            self.assertIsInstance(message_id, str)
            self.assertTrue(message_id.startswith('fake-user-'))
        finally:
            await self._teardown(c)

    async def test_close_reaps_process(self):
        c = await self._spawn()
        await c.initialize({'cwd': '.', 'provider': 'p', 'model': 'm'})
        await c.close()
        self.assertIsNotNone(c.process)
        self.assertIsNotNone(c.process.returncode)
        # Idempotent.
        await c.close()

    async def test_exit_before_init_raises_transport_closed(self):
        c = await self._spawn({'exit_before_init': True})
        try:
            with self.assertRaises(TransportClosedError) as ctx:
                await c.initialize({'cwd': '.', 'provider': 'p', 'model': 'm'})
            self.assertIn('exit code: 3', str(ctx.exception))
        finally:
            await self._teardown(c)

    async def test_nonexistent_command_raises(self):
        c = HarnessClient('/definitely/not/a/real/binary', env=fake_runtime_env())
        try:
            with self.assertRaises(TransportClosedError) as ctx:
                await c.initialize({'cwd': '.', 'provider': 'p', 'model': 'm'})
            self.assertIn('failed to start', str(ctx.exception))
        finally:
            await self._teardown(c)

    async def test_stderr_tail_captured(self):
        c = await self._spawn({'stderr': 'diagnostic-boom'})
        try:
            await c.initialize({'cwd': '.', 'provider': 'p', 'model': 'm'})
            for _ in range(100):
                if any('diagnostic-boom' in line for line in c._stderr_tail):
                    break
                await asyncio.sleep(LATENCY)
            self.assertTrue(any('diagnostic-boom' in line for line in c._stderr_tail))
        finally:
            await self._teardown(c)

    async def test_filter_throw_isolated_to_subscription(self):
        c = await self._spawn()
        try:
            await c.initialize({'cwd': '.', 'provider': 'p', 'model': 'm'})
            bad = c.subscribe(lambda n: (_ for _ in ()).throw(RuntimeError('boom')))
            good = c.subscribe(None)
            c._dispatch_notification('session.event', {'sessionId': 's', 'event': {'type': 'x'}})
            got = await asyncio.wait_for(good.next(), 2)
            self.assertEqual(got['method'], 'session.event')
            with self.assertRaises(RuntimeError):
                await bad.next()
        finally:
            await self._teardown(c)

    async def test_subscribe_session_tree_lineage(self):
        c = await self._spawn({'subagent': True})
        try:
            await c.initialize({'cwd': '.', 'provider': 'p', 'model': 'm'})
            sub = c.subscribe_session_tree('root')
            await c.prompt('root', [{'type': 'text', 'text': 'delegate'}])
            seen = []
            try:
                while True:
                    n = await asyncio.wait_for(sub.next(), 3)
                    seen.append(n)
                    if n.get('method') == 'session.status' \
                            and n.get('params', {}).get('status') == 'idle':
                        break
            except asyncio.TimeoutError:
                pass
            finally:
                sub.close()
            methods = [n.get('method') for n in seen]
            self.assertIn('subagent.started', methods)
            started = next(n for n in seen if n.get('method') == 'subagent.started')
            self.assertEqual(started['params'], {'parentSessionId': 'root',
                                                 'childSessionId': 'root-child'})
            self.assertEqual(c.session_parents.get('root-child'), 'root')
            # child session events are delivered under the root tree.
            self.assertTrue(any(
                n.get('method') == 'session.event'
                and n.get('params', {}).get('sessionId') == 'root-child'
                for n in seen))
            # descendant check
            self.assertTrue(c.is_descendant_of('root-child', 'root'))
            self.assertFalse(c.is_descendant_of('unrelated', 'root'))
        finally:
            await self._teardown(c)

    async def test_subscribe_born_failed_after_death(self):
        c = await self._spawn({'exit_before_init': True})
        try:
            sub = c.subscribe(None)
            with self.assertRaises(TransportClosedError):
                await sub.next()
        finally:
            await self._teardown(c)


if __name__ == '__main__':
    unittest.main(verbosity=2)