import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.esl import EslConnection, EslProtocolError

class Writer:
    def __init__(self): self.closed=False; self.writes=0
    def write(self, data): self.writes+=1
    async def drain(self): pass
    def close(self): self.closed=True
    async def wait_closed(self): pass

class AckDeadline(unittest.IsolatedAsyncioTestCase):
    async def test_missing_ack_closes_connection_and_prevents_late_commands(self):
        writer=Writer()
        connection=EslConnection(asyncio.StreamReader(),writer,reply_timeout=0.01)
        try:
            with self.assertRaisesRegex(EslProtocolError,'acknowledg.*timed out'):
                await asyncio.wait_for(connection.execute('playback','fixture.wav'),0.25)
            self.assertTrue(writer.closed)
            with self.assertRaises(EslProtocolError): await connection.api('status')
            self.assertEqual(writer.writes,1)
        finally: await connection.close()
