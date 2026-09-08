import re
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
import tempfile
from unittest.mock import patch
import datetime as dt
import relay_operations as operations
from temporary_carrier_relay import relay_xml


class TemporaryRelayTests(unittest.TestCase):
    def setUp(self):
        self.cfg = dict(public_ip='192.0.2.10', carrier_ip='198.51.100.20', peer_ip='192.0.2.30',
                        sip_port=5062, carrier_port=5060, esl_port=18022, rtp_start=11000,
                        rtp_end=11019, channel_limit=5, username='relay_test_identity',
                        caller_ids=['966135110000', '966135110001'])

    def test_digest_cannot_be_bypassed_by_source_acl_and_identity_is_tenant_scoped(self):
        doc = ET.fromstring(relay_xml(self.cfg, 'a' * 64, 'b' * 64))
        profile = doc.find('.//profile[@name="carrier-relay"]/settings')
        values = {p.get('name'): p.get('value') for p in profile}
        self.assertEqual(values['auth-calls'], 'true')
        self.assertEqual(values['disable-register'], 'true')
        self.assertNotIn('apply-inbound-acl', values)
        self.assertEqual(values['challenge-realm'], self.cfg['carrier_ip'])
        rules = doc.findall('.//extension[@name="authenticated-tenant-outbound"]/condition')
        self.assertEqual([r.get('field') for r in rules],
                         ['network_addr', '${sip_auth_username}', 'caller_id_number', 'destination_number'])
        self.assertIsNotNone(re.fullmatch(rules[2].get('expression'), '+966135110000'))
        self.assertIsNone(re.fullmatch(rules[2].get('expression'), '+966135110002'))
        self.assertIsNone(re.fullmatch(rules[3].get('expression'), '2000'))
        self.assertIsNone(re.fullmatch(rules[3].get('expression'), '966123456789&park()'))
        self.assertEqual(doc.find('.//action[@application="bridge"]').get('data'),
                         'sofia/carrier-relay/$1@198.51.100.20:5060')
        self.assertEqual(doc.find('.//action[@application="sched_hangup"]').get('data'), '+180 NORMAL_CLEARING')

    def test_rejects_unbounded_ports_identity_and_xml_input(self):
        for key, value in [('peer_ip', '0.0.0.0/0'), ('carrier_ip', 'example.test'),
                           ('username', 'relay.*'), ('caller_ids', ['.*']), ('caller_ids', []),
                           ('rtp_end', 65535), ('channel_limit', 100), ('sip_port', 0)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                relay_xml(dict(self.cfg, **{key: value}), 'a' * 64, 'b' * 64)

    def test_failed_install_cannot_remove_a_preexisting_operator_deployment(self):
        with tempfile.TemporaryDirectory() as path, patch.object(operations, 'ROOT', Path(path)), \
             patch.object(operations, 'install_gateway', side_effect=RuntimeError('Already exists')), \
             patch.object(operations, 'remove') as remove:
            with self.assertRaises(RuntimeError):
                operations.install('gateway', {})
            remove.assert_not_called()

    def test_failed_install_cleans_its_own_partial_deployment(self):
        with tempfile.TemporaryDirectory() as path:
            root = Path(path) / 'new'
            def partial(_cfg):
                root.mkdir()
                raise RuntimeError('Rescan failed')
            with patch.object(operations, 'ROOT', root), patch.object(operations, 'install_gateway', side_effect=partial), \
                 patch.object(operations, 'remove') as remove:
                with self.assertRaises(RuntimeError):
                    operations.install('gateway', {})
                remove.assert_called_once_with('gateway')

    def test_host_deadline_cannot_be_expired_or_unbounded(self):
        now = dt.datetime.now(dt.timezone.utc)
        for delta in (-60, 7200):
            with self.assertRaises(ValueError):
                operations.remaining({'expiresAt': (now + dt.timedelta(seconds=delta)).isoformat()})
        self.assertGreater(operations.remaining({'expiresAt': (now + dt.timedelta(minutes=10)).isoformat()}), 500)


if __name__ == '__main__':
    unittest.main()
