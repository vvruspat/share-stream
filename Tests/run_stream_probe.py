#!/usr/bin/env python3
"""Start the relay before the native peer, then verify direct and relayed audio."""
import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'server'))
from relay import Relay


class LegacyRelay(Relay):
    """Model the published v0.4.1 relay, which only accepts Float32 audio."""
    def datagram_received(self, data, address):
        if len(data) >= 5 and data[4] in (12, 13):
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
            child = await asyncio.create_subprocess_exec(probe, '--port', str(port), '--seconds', '6' if cycle else '5',
                '--force-relay', forced, '--quality', quality, '--cycle-quality', '1' if cycle else '0',
                '--expected-quality', '0' if legacy else quality, '--jitter', '40')
            try:
                if await asyncio.wait_for(child.wait(), timeout=20) != 0:
                    return 1
            except TimeoutError:
                child.kill()
                await child.wait()
                raise
        finally:
            transport.close()
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main(sys.argv[1])))
