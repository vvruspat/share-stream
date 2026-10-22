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

    def wire(self, kind, role=1, peer=b"a"*16, room=None, body=bytes(16), sequence=1):
        return relay.HEADER.pack(b"SST1", kind, role, 0, room or self.room, peer, sequence)+body

    def join(self, address, role=1, peer=b"a"*16, room=None, group=False):
        self.server.datagram_received(self.wire(relay.HELLO, role, peer, room), address)
        cookie = self.server.transport.sent[-1][0][48:]
        self.server.datagram_received(self.wire(relay.JOIN, role, peer, room, cookie, sequence=relay.GROUP_VERSION if group else 1), address)
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

    def test_new_quality_and_capabilities_only_reach_the_registered_partner(self):
        a, b, attacker = ("127.0.0.1", 1), ("127.0.0.1", 2), ("127.0.0.1", 3)
        self.join(a)
        self.join(b, 2, b"b"*16)
        for size in (192, 812):
            audio = self.wire(relay.ENCODED_AUDIO, body=bytes(size-48))
            before = len(self.server.transport.sent)
            self.server.datagram_received(audio, attacker)
            self.assertEqual(before, len(self.server.transport.sent))
            self.server.datagram_received(audio, a)
            self.assertEqual(self.server.transport.sent[-1], (audio, b))
        for role, identity, source, target in ((1, b"a"*16, a, b), (2, b"b"*16, b, a)):
            caps = self.wire(relay.CAPABILITIES, role, identity, body=bytes(56))
            self.server.datagram_received(caps, source)
            self.assertEqual(self.server.transport.sent[-1], (caps, target))
        before = len(self.server.transport.sent)
        for kind, role, identity, source, size in (
            (relay.ENCODED_AUDIO, 2, b"b"*16, b, 812),
            (relay.ENCODED_AUDIO, 1, b"a"*16, a, 92),
            (relay.ENCODED_AUDIO, 1, b"a"*16, a, 1201),
            (relay.CAPABILITIES, 1, b"a"*16, a, 64),
            (relay.PING, 1, b"a"*16, a, 1048),
        ):
            self.server.datagram_received(self.wire(kind, role, identity, body=bytes(size-48)), source)
        self.assertEqual(before, len(self.server.transport.sent))

    def test_both_peers_can_exchange_roles_without_changing_the_room(self):
        a, b = ("127.0.0.1", 1), ("127.0.0.1", 2)
        self.join(a)
        self.join(b, 2, b"b"*16)
        self.server.datagram_received(self.wire(relay.LEAVE), a)
        self.server.datagram_received(self.wire(relay.LEAVE, 2, b"b"*16), b)
        self.assertEqual(self.join(a, 2)[48], 0)
        self.assertEqual(self.join(b, 1, b"b"*16)[48], 0)
        audio = self.wire(relay.AUDIO, 1, b"b"*16, body=bytes(relay.AUDIO_SIZE-48))
        self.server.datagram_received(audio, b)
        self.assertEqual(self.server.transport.sent[-1], (audio, a))

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

    def test_group_fanout_is_bounded_and_targeted_relay_does_not_reach_direct_listeners(self):
        sender=("127.0.0.1",10001)
        self.assertEqual(self.join(sender,group=True)[48],0)
        listeners=[]
        for i in range(7):
            address=("127.0.0.1",10002+i);identity=bytes([i+1])*16
            self.assertEqual(self.join(address,2,identity,group=True)[48],0)
            listeners.append((address,identity))
        self.assertEqual(self.join(("127.0.0.1",10009),2,b"z"*16,group=True)[48],3)
        audio=self.wire(relay.AUDIO,body=bytes(relay.AUDIO_SIZE-48))
        target,identity=listeners[2]
        packet=self.wire(relay.FORWARD,body=identity+audio)
        before=len(self.server.transport.sent)
        self.server.datagram_received(packet,sender)
        self.assertEqual(self.server.transport.sent[before:],[(audio,target)])
        before=len(self.server.transport.sent)
        self.server.datagram_received(packet,listeners[0][0])
        self.server.datagram_received(self.wire(relay.FORWARD,body=b"?"*16+audio),sender)
        bad=self.wire(relay.AUDIO,peer=b"?"*16,body=bytes(relay.AUDIO_SIZE-48))
        self.server.datagram_received(self.wire(relay.FORWARD,body=identity+bad),sender)
        self.assertEqual(len(self.server.transport.sent),before)

    def test_legacy_sender_requires_update_before_accepting_more_than_one_listener(self):
        self.join(("127.0.0.1",1))
        self.assertEqual(self.join(("127.0.0.1",2),2,b"b"*16)[48],0)
        self.assertEqual(self.join(("127.0.0.1",3),2,b"c"*16,group=True)[48],4)


if __name__ == "__main__":
    unittest.main()
