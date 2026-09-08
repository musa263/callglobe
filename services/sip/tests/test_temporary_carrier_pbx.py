import unittest
import xml.etree.ElementTree as ET

from temporary_carrier_pbx import config_xml, number


class TemporaryCarrierTests(unittest.TestCase):
    def setUp(self):
        self.cfg = dict(public_ip='192.0.2.10', carrier_ip='198.51.100.20',
                        did='966135110000', national_did='0135110000',
                        caller_id='966135110000', sip_port=5062)

    def test_only_explicit_carrier_and_did_can_reach_bounded_echo(self):
        doc = ET.fromstring(config_xml(self.cfg, 'secret'))
        acl = doc.find(".//list[@name='test-carrier']")
        self.assertEqual(acl.get('default'), 'deny')
        self.assertEqual([node.attrib for node in acl],
                         [dict(type='allow', cidr='198.51.100.20/32')])
        route = doc.find(".//context[@name='carrier-in']//condition")
        import re
        self.assertIsNotNone(re.fullmatch(route.get('expression'), '+966135110000'))
        self.assertIsNotNone(re.fullmatch(route.get('expression'), '0135110000'))
        self.assertIsNone(re.fullmatch(route.get('expression'), '966135110001'))
        self.assertIsNone(re.fullmatch(route.get('expression'), 'test'))
        self.assertEqual(doc.find(".//action[@application='sched_hangup']").get('data'),
                         '+35 NORMAL_CLEARING')
        self.assertIsNone(doc.find(".//action[@application='bridge']"))
        self.assertIsNone(doc.find('.//gateway'))

    def test_event_socket_is_loopback_and_password_is_escaped(self):
        doc = ET.fromstring(config_xml(self.cfg, 'a<&b'))
        params = {item.get('name'): item.get('value') for item in
                  doc.findall(".//configuration[@name='event_socket.conf']//param")}
        self.assertEqual(params['listen-ip'], '127.0.0.1')
        self.assertEqual(params['password'], 'a<&b')

    def test_rejects_dialstring_and_xml_injection(self):
        for value in ('+966135110000', '1234', '966135110000&park()', '966135110000\n'):
            with self.assertRaises(ValueError):
                number(value)
        for key, value in [('public_ip', '0.0.0.0&bad'), ('carrier_ip', '127.0.0.1/0'),
                           ('national_did', '.*'), ('sip_port', 22)]:
            with self.assertRaises(ValueError):
                config_xml(dict(self.cfg, **{key: value}), 'secret')


if __name__ == '__main__':
    unittest.main()
