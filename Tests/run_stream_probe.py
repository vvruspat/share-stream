#!/usr/bin/env python3
"""Start the relay before the native peer, then verify direct and relayed audio."""
import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'server'))
from relay import Relay


async def main(probe):
    loop = asyncio.get_running_loop()
    for forced in ['0', '1']:
        transport, _ = await loop.create_datagram_endpoint(Relay, local_addr=('127.0.0.1', 0))
        port = transport.get_extra_info('sockname')[1]
        try:
            child = await asyncio.create_subprocess_exec(probe, '--port', str(port), '--seconds', '3',
                                                         '--force-relay', forced)
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
