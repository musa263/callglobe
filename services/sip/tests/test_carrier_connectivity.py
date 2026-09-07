import errno
import socket
import unittest
from unittest.mock import patch
from carrier_connectivity import probe


class SocketFixture:
    def __init__(self, failure=None):
        self.failure = failure
        self.packets = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def connect(self, address):
        self.target = address

    def getsockname(self):
        return '198.51.100.10', 45000

    def settimeout(self, timeout):
        assert 0 < timeout <= 3

    def send(self, packet):
        self.packets.append(packet)

    def recv(self, size):
        if self.failure:
            raise self.failure
        call_id = next(line for line in self.packets[-1].decode().split('\r\n') if line.startswith('Call-ID:'))
        return f'SIP/2.0 200 OK\r\n{call_id}\r\nContent-Length: 0\r\n\r\n'.encode()


class CarrierConnectivityTests(unittest.TestCase):
    def test_response_and_source_identity(self):
        fixture = SocketFixture()
        with patch('carrier_connectivity.socket.socket', return_value=fixture):
            report = probe('192.0.2.1', 5060, '198.51.100.11')
        self.assertEqual(report['status'], 200)
        self.assertFalse(report['source_matches_expected'])
        self.assertEqual(len(fixture.packets), 1)
        self.assertTrue(fixture.packets[0].startswith(b'OPTIONS '))
        self.assertNotIn(b'Authorization:', fixture.packets[0])

    def test_timeout_is_bounded_to_two_probes(self):
        fixture = SocketFixture(socket.timeout())
        with patch('carrier_connectivity.socket.socket', return_value=fixture):
            report = probe('192.0.2.1', 5060, '198.51.100.10')
        self.assertEqual(report['result'], 'no_response')
        self.assertEqual(len(fixture.packets), 2)
        self.assertEqual(fixture.packets[0], fixture.packets[1])

    def test_socket_rejection_is_not_reported_as_success(self):
        fixture = SocketFixture(ConnectionRefusedError(errno.ECONNREFUSED, 'refused'))
        with patch('carrier_connectivity.socket.socket', return_value=fixture):
            report = probe('192.0.2.1', 5060, '198.51.100.10')
        self.assertEqual(report['result'], 'socket_error')
        self.assertEqual(report['errno'], errno.ECONNREFUSED)


if __name__ == '__main__':
    unittest.main()
