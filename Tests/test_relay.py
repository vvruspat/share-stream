import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("relay", pathlib.Path(__file__).parents[1]/"server/relay.py")
relay = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = relay
spec.loader.exec_module(relay)


class Transport:
    def __init__(self):
        self.sent = []

    def sendto(self, data, address):
        self.sent.append((data, address))


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.server = relay.Relay(max_rooms=1)
        self.server.transport = Transport()
        self.room = b"r"*16

    def wire(self, kind, role=1, peer=b"a"*16, room=None, body=bytes(16)):
        return relay.HEADER.pack(b"SST1", kind, role, 0, room or self.room, peer, 1)+body

    def join(self, address, role=1, peer=b"a"*16, room=None):
        self.server.datagram_received(self.wire(relay.HELLO, role, peer, room), address)
        cookie = self.server.transport.sent[-1][0][48:]
        self.server.datagram_received(self.wire(relay.JOIN, role, peer, room, cookie), address)
        return next(data for data, _ in reversed(self.server.transport.sent)
                    if relay.HEADER.unpack_from(data)[1] == relay.READY)

    def test_spoofed_join_and_cookie_reuse_from_another_address(self):
        a, b = ("127.0.0.1", 1), ("127.0.0.1", 2)
        self.server.datagram_received(self.wire(relay.JOIN), a)
        self.assertFalse(self.server.peers)
        self.server.datagram_received(self.wire(relay.HELLO), a)
        cookie = self.server.transport.sent[-1][0][48:]
        self.server.datagram_received(self.wire(relay.JOIN, body=cookie), b)
        self.assertFalse(self.server.peers)

    def test_only_registered_sender_reaches_registered_receiver(self):
        a, b, attacker = ("127.0.0.1", 1), ("127.0.0.1", 2), ("127.0.0.1", 3)
        self.join(a)
        self.join(b, 2, b"b"*16)
        audio = self.wire(relay.AUDIO, body=bytes(relay.AUDIO_SIZE-48))
        count = len(self.server.transport.sent)
        self.server.datagram_received(audio, attacker)
        self.assertEqual(count, len(self.server.transport.sent))
        self.server.datagram_received(audio, a)
        self.assertEqual(self.server.transport.sent[-1], (audio, b))
        reflected = self.wire(relay.AUDIO, 2, b"b"*16, body=bytes(relay.AUDIO_SIZE-48))
        count = len(self.server.transport.sent)
        self.server.datagram_received(reflected, b)
        self.assertEqual(count, len(self.server.transport.sent))

    def test_role_conflict_capacity_and_leave(self):
        a, b = ("127.0.0.1", 1), ("127.0.0.1", 2)
        self.join(a)
        self.assertEqual(self.join(b, peer=b"b"*16)[48], 2)
        self.assertEqual(self.join(b, room=b"s"*16)[48], 3)
        self.server.datagram_received(self.wire(relay.LEAVE), a)
        self.assertFalse(self.server.rooms)
        self.assertEqual(self.join(b, peer=b"b"*16)[48], 0)

    def test_expiration_and_malformed_packets(self):
        self.join(("127.0.0.1", 1))
        peer = next(iter(self.server.peers.values()))
        self.server.cleanup(peer.seen+5)
        self.assertFalse(self.server.peers)
        for bad in (b"", bytes(64), bytes(1048), self.wire(relay.AUDIO)):
            self.server.datagram_received(bad, ("127.0.0.1", 3))
        self.assertFalse(self.server.peers)

    def test_introduction_only_after_both_peers_prove_reachability(self):
        a, b = ("127.0.0.1", 10001), ("127.0.0.2", 10002)
        self.join(a)
        self.assertFalse(any(relay.HEADER.unpack_from(data)[1] == relay.ENDPOINT
                             for data, _ in self.server.transport.sent))
        self.join(b, 2, b"b"*16)
        endpoints = [(data, addr) for data, addr in self.server.transport.sent
                     if relay.HEADER.unpack_from(data)[1] == relay.ENDPOINT]
        self.assertEqual(len(endpoints), 2)
        for data, address in endpoints:
            self.assertEqual(len(data), 80)
            self.assertIn(address, (a, b))
            self.assertEqual(data[54:70], b"b"*16 if address == a else b"a"*16)


if __name__ == "__main__":
    unittest.main()
