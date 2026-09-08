import json
from pathlib import Path
import re
import sqlite3
from tempfile import TemporaryDirectory
import unittest

class CdrOutbox(unittest.TestCase):
    def test_outage_retry_survives_restart_without_duplicate_or_quote_injection(self):
        entrypoint=(Path(__file__).parents[1]/'kamailio/docker-entrypoint.sh').read_text()
        schema=re.search(r"sqlite3 /var/lib/kamailio/cdr.db '([^']+)'",entrypoint).group(1)
        with TemporaryDirectory() as temp:
            path=Path(temp)/'cdr.db'
            body=json.dumps({'callId':"quote'; DROP TABLE outbox; --",'event':'bye'})
            with sqlite3.connect(path) as db:
                db.executescript(schema)
                for _ in range(2): db.execute("insert or ignore into outbox(body) values(CAST(X'%s' AS TEXT))" % body.encode().hex())
                db.execute('update outbox set attempts=attempts+1,next_at=60')
            with sqlite3.connect(path) as db:
                rows=db.execute('select body,attempts from outbox where next_at<=60').fetchall()
                self.assertEqual(rows,[(body,1)])
                db.execute('delete from outbox where id=1')
            with sqlite3.connect(path) as db: self.assertEqual(db.execute('select count(*) from outbox').fetchone()[0],0)
