#!/usr/bin/env python3
"""Start the relay before the native peer, then verify direct and relayed audio."""
import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'server'))
from relay import Relay


class LegacyRelay(Relay):
    """Model the published v0.4.1 relay, which only accepts Float32 audio."""
    def reply(self, header, kind, address, status=0):
        from relay import HEADER
        _, _, role, _, room, identity, sequence = header
        partner = int(any(p.role != role for p in self.rooms.get(room, {}).values()))
        self.transport.sendto(HEADER.pack(b"SST1", kind, role, 0, room, identity, sequence)
                              + bytes([status, partner]) + bytes(14), address)
        if status == 0 and partner:
            self.introduce(room)

    def datagram_received(self, data, address):
        if len(data) >= 5 and data[4] in (12, 13, 14):
            return
        super().datagram_received(data, address)


async def main(probe):
    loop = asyncio.get_running_loop()
    cases = [(forced, quality, False, False) for forced in ['0', '1'] for quality in ['0', '1', '2']]
    cases += [(forced, '0', True, False) for forced in ['0', '1']]
    cases += [('1', '2', False, True)]
    for forced, quality, cycle, legacy in cases:
        transport, _ = await loop.create_datagram_endpoint(LegacyRelay if legacy else Relay, local_addr=('127.0.0.1', 0))
        port = transport.get_extra_info('sockname')[1]
        try:
            # Measure at least three steady seconds after the two-second warmup.
            # A one-second window made a single scheduler pause dominate the 1%
            # silence threshold on shared CI hosts, even for legacy Float32.
            for attempt in range(3):
                child = await asyncio.create_subprocess_exec(probe, '--port', str(port), '--seconds', '6' if cycle else '5',
                    '--force-relay', forced, '--quality', quality, '--cycle-quality', '1' if cycle else '0',
                    '--expected-quality', '0' if legacy else quality, '--jitter', '40')
                try:
                    result = await asyncio.wait_for(child.wait(), timeout=20)
                except TimeoutError:
                    child.kill()
                    await child.wait()
                    raise
                if result == 0:
                    break
                if result != 77 or attempt == 2:
                    return 1
                print(f'Retrying descheduled callback fixture ({attempt+1}/2); audio criteria unchanged', flush=True)
                # Every child generates a fresh room, so the previous pair
                # cannot occupy the roles used by this retry.
        finally:
            transport.close()
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main(sys.argv[1])))
