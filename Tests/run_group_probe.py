"""Exercise real encrypted native fanout with direct and relayed listeners."""
import asyncio
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from relay import Relay, HEADER, FORWARD, AUDIO, ENCODED_AUDIO


class ObservedRelay(Relay):
    def __init__(self):
        super().__init__()
        self.targets = set()
        self.broadcast = 0
        self.started = time.monotonic()
        self.steady_targets = set()

    def datagram_received(self, data, address):
        if len(data) >= 64:
            kind = HEADER.unpack_from(data)[1]
            if kind == FORWARD:
                self.targets.add(data[48:64])
                room = HEADER.unpack_from(data)[4]
                if time.monotonic()-self.started > 4.5 and data[48:64] in self.rooms.get(room, {}):
                    self.steady_targets.add(data[48:64])
            elif kind in (AUDIO, ENCODED_AUDIO):
                self.broadcast += 1
        super().datagram_received(data, address)


async def main(probe):
    loop = asyncio.get_running_loop()
    for quality in range(3):
        transport, relay = await loop.create_datagram_endpoint(ObservedRelay, local_addr=('127.0.0.1', 0))
        try:
            child = await asyncio.create_subprocess_exec(probe, str(transport.get_extra_info('sockname')[1]), str(quality))
            result = await asyncio.wait_for(child.wait(), 20)
            if result or len(relay.steady_targets) != 3:
                return 1
        finally:
            transport.close()
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main(sys.argv[1])))
