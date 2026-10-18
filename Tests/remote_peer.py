#!/usr/bin/env python3
"""Headless receiver for a two-machine P2P synthetic-audio integration check.
Uses the system libsodium shared library to independently check the wire format.
No sound device is opened; only generated test audio should be sent here.
"""
import argparse
import ctypes as ct
import ctypes.util
import hashlib
import math
import secrets
import socket
import struct
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--server", default="13.140.153.191")
parser.add_argument("--room", required=True)
parser.add_argument("--seconds", type=int, default=25)
args = parser.parse_args()
lib = ct.CDLL(ctypes.util.find_library("sodium"))
lib.sodium_init()
lib.crypto_aead_xchacha20poly1305_ietf_encrypt.argtypes = [ct.c_void_p,ct.c_void_p,ct.c_void_p,ct.c_ulonglong,ct.c_void_p,ct.c_ulonglong,ct.c_void_p,ct.c_void_p,ct.c_void_p]
lib.crypto_aead_xchacha20poly1305_ietf_decrypt.argtypes = [ct.c_void_p,ct.c_void_p,ct.c_void_p,ct.c_void_p,ct.c_ulonglong,ct.c_void_p,ct.c_ulonglong,ct.c_void_p,ct.c_void_p]
lib.crypto_aead_xchacha20poly1305_ietf_decrypt.restype = ct.c_int


def buf(data):
    return ct.create_string_buffer(data)


def derive(label, size):
    secret = bytes.fromhex(args.room)
    return hashlib.blake2b(label,key=secret,digest_size=size).digest()


key = derive(b"ShareStream v1 audio encryption", 32)
room = derive(b"ShareStream v1 relay routing", 16)
peer = secrets.token_bytes(16)
header_struct = struct.Struct("!4sBBH16s16sQ")
server = (socket.gethostbyname(args.server), 48100)
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(("0.0.0.0", 0))
sock.settimeout(0.05)


def header(kind, sequence=0):
    return header_struct.pack(b"SST1", kind, 2, 0, room, peer, sequence)


def probe(kind, sequence):
    head, nonce = header(kind, sequence), secrets.token_bytes(24)
    cipher = ct.create_string_buffer(32)
    lib.crypto_aead_xchacha20poly1305_ietf_encrypt(cipher,None,buf(bytes(16)),16,buf(head),48,None,buf(nonce),buf(key))
    return head+nonce+cipher.raw[16:]+cipher.raw[:16]


def decrypt(data):
    plain = ct.create_string_buffer(len(data)-88)
    cipher=data[88:]+data[72:88]
    result = lib.crypto_aead_xchacha20poly1305_ietf_decrypt(plain,None,None,buf(cipher),len(cipher),buf(data[:48]),48,buf(data[48:72]),buf(key))
    return plain.raw if result == 0 else None


start = time.monotonic()
last_hello = last_probe = 0
endpoint = None
received = direct_audio = authenticated_pongs = 0
energy = 0
while time.monotonic()-start < args.seconds:
    now = time.monotonic()
    if now-last_hello >= 0.5:
        sock.sendto(header(1)+bytes(16), server)
        sock.sendto(header(6)+bytes(16), server)
        last_hello = now
    if endpoint and now-last_probe >= 0.25:
        sock.sendto(probe(10, int(now*1e6)), endpoint)
        last_probe = now
    try:
        data, address = sock.recvfrom(1200)
    except socket.timeout:
        continue
    if len(data) < 48:
        continue
    magic, kind, role, reserved, room_id, other, sequence = header_struct.unpack_from(data)
    if magic != b"SST1" or room_id != room or reserved:
        continue
    if kind == 2 and address == server and other == peer:
        sock.sendto(header(3)+data[48:64], server)
    elif kind == 9 and address == server and other == peer and len(data) == 80:
        endpoint = (socket.inet_ntoa(data[48:52]), struct.unpack("!H", data[52:54])[0])
    elif kind in (10, 11) and role == 1 and len(data) == 104 and decrypt(data) is not None:
        if kind == 10:
            sock.sendto(probe(11, sequence), address)
        else:
            authenticated_pongs += 1
    elif kind == 5 and role == 1 and len(data) == 1048:
        plain = decrypt(data)
        if plain:
            samples = struct.unpack("<240f", plain)
            energy += sum(x*x for x in samples)
            received += 1
            direct_audio += address != server
sock.sendto(header(8)+bytes(16), server)
rms = math.sqrt(energy/(received*240)) if received else 0
print(f"Remote receiver: {received} authenticated audio packets, {direct_audio} direct, {authenticated_pongs} P2P replies, RMS {rms:.5f}", flush=True)
raise SystemExit(0 if received > 100 and direct_audio > received*0.9 and 0.05 < rms < 0.15 else 1)
