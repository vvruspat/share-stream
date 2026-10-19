#!/usr/bin/env python3
"""Share Stream v1: bounded two-party UDP relay; no audio decryption keys."""
import argparse
import asyncio
import hashlib
import hmac
import logging
import secrets
import struct
import socket
import time
from dataclasses import dataclass

HEADER = struct.Struct("!4sBBH16s16sQ")
CONTROL_SIZE, AUDIO_SIZE = 64, 1048
HELLO, COOKIE, JOIN, READY, AUDIO, PING, PONG, LEAVE = range(1, 9)
ENDPOINT = 9
ENCODED_AUDIO, CAPABILITIES = 12, 13


@dataclass
class Peer:
    address: tuple
    room: bytes
    identity: bytes
    role: int
    seen: float
    budget_at: float
    budget: float = 700


class Relay(asyncio.DatagramProtocol):
    def __init__(self, max_rooms=64):
        self.secret = secrets.token_bytes(32)
        self.peers = {}
        self.rooms = {}
        self.max_rooms = max_rooms
        self.transport = None
        self.last_cleanup = 0
        self.global_at = time.monotonic()
        self.global_budget = 20000.0

    def connection_made(self, transport):
        self.transport = transport
        logging.info("UDP relay listening on %s", transport.get_extra_info("sockname"))

    def cookie(self, address, role, room, identity, minute):
        message = (f"{address[0]}:{address[1]}:{minute}:".encode()
                   + bytes([role]) + room + identity)
        return hmac.new(self.secret, message, hashlib.sha256).digest()[:16]

    def remove(self, peer):
        self.peers.pop((peer.room, peer.identity), None)
        room = self.rooms.get(peer.room)
        if room and room.get(peer.role) is peer:
            del room[peer.role]
            if not room:
                del self.rooms[peer.room]

    def cleanup(self, now):
        if now - self.last_cleanup < 1:
            return
        self.last_cleanup = now
        for peer in list(self.peers.values()):
            if now - peer.seen > 4:
                self.remove(peer)

    def reply(self, header, kind, address, status=0):
        _, _, role, _, room, identity, sequence = header
        partner = int((3-role) in self.rooms.get(room, {}))
        data = HEADER.pack(b"SST1", kind, role, 0, room, identity, sequence)
        self.transport.sendto(data + bytes([status, partner]) + bytes(14), address)
        if status == 0 and partner:
            self.introduce(room)

    def introduce(self, room):
        peers = self.rooms.get(room, {})
        if 1 not in peers or 2 not in peers:
            return
        for role in (1, 2):
            owner, partner = peers[role], peers[3-role]
            header = HEADER.pack(b"SST1", ENDPOINT, role, 0, room, owner.identity, 0)
            endpoint = socket.inet_aton(partner.address[0]) + struct.pack("!H", partner.address[1])
            self.transport.sendto(header+endpoint+partner.identity+bytes(10), owner.address)

    def datagram_received(self, data, address):
        if len(data) < CONTROL_SIZE or len(data) > 1200:
            return
        now = time.monotonic()
        self.global_budget = min(20000, self.global_budget+(now-self.global_at)*20000)
        self.global_at = now
        if self.global_budget < 1:
            return
        self.global_budget -= 1
        header = HEADER.unpack_from(data)
        magic, kind, role, reserved, room, identity, _ = header
        if magic != b"SST1" or role not in (1, 2) or reserved or kind not in (*range(1, 9), ENCODED_AUDIO, CAPABILITIES):
            return
        if not ((kind == AUDIO and len(data) == AUDIO_SIZE)
                or (kind == ENCODED_AUDIO and 93 <= len(data) <= 1200)
                or (kind == CAPABILITIES and len(data) == 104)
                or (kind not in (AUDIO, ENCODED_AUDIO, CAPABILITIES) and len(data) == CONTROL_SIZE)):
            return
        self.cleanup(now)
        if kind == HELLO:
            token = self.cookie(address, role, room, identity, int(time.time()//60))
            self.transport.sendto(HEADER.pack(b"SST1", COOKIE, role, 0, room, identity, 0)+token, address)
            return
        if kind == JOIN:
            minute = int(time.time()//60)
            if not any(hmac.compare_digest(data[48:], self.cookie(address, role, room, identity, m))
                       for m in (minute, minute-1)):
                return
            peers = self.rooms.get(room, {})
            occupant = peers.get(role)
            if occupant and (occupant.identity != identity or occupant.address != address):
                self.reply(header, READY, address, 2)
                return
            if room not in self.rooms and len(self.rooms) >= self.max_rooms:
                self.reply(header, READY, address, 3)
                return
            if occupant:
                occupant.seen = now
            else:
                peer = Peer(address, room, identity, role, now, now)
                self.rooms.setdefault(room, {})[role] = peer
                self.peers[(room, identity)] = peer
            self.reply(header, READY, address)
            return
        peer = self.peers.get((room, identity))
        if peer is None or peer.address != address or peer.role != role:
            return
        peer.budget = min(700, peer.budget+(now-peer.budget_at)*700)
        peer.budget_at = now
        if peer.budget < 1:
            return
        peer.budget -= 1
        peer.seen = now
        if kind == PING:
            self.reply(header, PONG, address)
        elif kind == LEAVE:
            self.remove(peer)
        elif kind == CAPABILITIES:
            partner = self.rooms[room].get(3-role)
            if partner:
                self.transport.sendto(data, partner.address)
        elif kind in (AUDIO, ENCODED_AUDIO) and role == 1:
            partner = self.rooms[room].get(2)
            if partner:
                self.transport.sendto(data, partner.address)


async def main(host, port, max_rooms):
    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(
        lambda: Relay(max_rooms), local_addr=(host, port))
    try:
        await asyncio.Future()
    finally:
        transport.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=48100)
    parser.add_argument("--max-rooms", type=int, default=64)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    try:
        asyncio.run(main(args.host, args.port, args.max_rooms))
    except KeyboardInterrupt:
        pass
