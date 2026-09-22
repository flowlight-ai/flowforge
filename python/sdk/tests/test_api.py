"""Tests for the high-level FlowForgeHarness / HarnessSession over a fake
runtime subprocess."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _helpers import (FAKE_RUNTIME, FlowForgeHarness, TransportClosedError,
                      api as api_mod, fake_runtime_env)

LATENCY = 0.01


def make_harness(config=None):
    return FlowForgeHarness(
        command=sys.executable,
        args=[FAKE_RUNTIME],
        env=fake_runtime_env(config),
        request_timeout_ms=5000,
    )


class FlowForgeHarnessTest(unittest.IsolatedAsyncioTestCase):

    async def test_run_whole_idle_round(self):
        async with make_harness() as harness:
            result = await harness.run('hello world')
            self.assertTrue(result.session_id.startswith('session-'))
            self.assertEqual(result.final_response, 'hello from fake runtime')
            self.assertTrue(result.events)
            self.assertTrue(result.notifications)
            self.assertEqual(result.events[0]['type'], 'agent/inbox/spliced')
            self.assertEqual(result.events[-1]['type'], 'assistant/message')

    async def test_run_on_named_session(self):
        async with make_harness() as harness:
            session_handle = harness.session('my-session')
            result = await session_handle.run('hi')
            self.assertEqual(result.session_id, 'my-session')
            self.assertEqual(result.final_response, 'hello from fake runtime')

    async def test_on_notification_observer(self):
        async with make_harness() as harness:
            observed = []
            result = await harness.run('hi', on_notification=observed.append)
            self.assertGreaterEqual(len(observed), len(result.notifications))
            self.assertEqual(len(observed), len(result.notifications))

    async def test_context_manager_closes(self):
        harness = make_harness()
        async with harness as h:
            await h.start()
            proc = h.client.process
            self.assertIsNotNone(proc)
        # closed by __aexit__: process reaped.
        self.assertIsNotNone(proc.returncode)

    async def test_failed_handshake_replaces_client(self):
        harness = make_harness({'exit_before_init': True})
        try:
            first = harness.client
            with self.assertRaises(TransportClosedError):
                await harness.start()
            self.assertIsNot(harness.client, first)
        finally:
            await harness.close()

    def test_normalize_input_utilities(self):
        self.assertEqual(api_mod.normalize_input('hi'),
                         [{'type': 'text', 'text': 'hi'}])
        self.assertEqual(api_mod.normalize_input([{'type': 'text', 'text': 'x'}]),
                         [{'type': 'text', 'text': 'x'}])

    def test_final_response_concatenation(self):
        events = [
            {'type': 'turn/start', 'data': {}},
            {'type': 'assistant/message', 'data': {'message': {'content': [
                {'type': 'text', 'text': 'part1'},
                {'type': 'text', 'text': 'part2'},
            ]}}},
            {'type': 'turn/end', 'data': {}},
        ]
        self.assertEqual(api_mod.final_response(events), 'part1part2')
        self.assertEqual(api_mod.final_response([]), '')

    def test_validated_session_event_protocol_error(self):
        with self.assertRaises(api_mod.SdkProtocolError):
            api_mod.validated_session_event({'type': 'assistant/message',
                                             'data': {'message': {'content': 'not-an-array'}}})
        self.assertEqual(
            api_mod.validated_session_event({'type': 'turn/start', 'data': {}}),
            {'type': 'turn/start', 'data': {}})

    def test_is_inbox_receipt(self):
        receipt = {'type': 'agent/inbox/spliced',
                   'data': {'inserted': [{'id': 'mid-1'}]}}
        self.assertTrue(api_mod.is_inbox_receipt(receipt, 'mid-1'))
        self.assertFalse(api_mod.is_inbox_receipt(receipt, 'mid-2'))
        self.assertFalse(api_mod.is_inbox_receipt({'type': 'other'}, 'mid-1'))


if __name__ == '__main__':
    unittest.main(verbosity=2)