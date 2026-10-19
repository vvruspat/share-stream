import os
from pathlib import Path
import subprocess
import unittest

HELPER = Path(__file__).resolve().parents[1]/'scripts/apple-retry.sh'


class AppleRetryTests(unittest.TestCase):
    def run_shell(self, body):
        return subprocess.run(['bash', '-c', 'source "$1"\n' + body, 'test', str(HELPER)],
                              env={**os.environ, 'APPLE_RETRY_DELAY': '0', 'APPLE_RETRY_ATTEMPTS': '3'},
                              capture_output=True, text=True)

    def test_transient_failure_recovers(self):
        result = self.run_shell('n=0\nflaky() { n=$((n+1)); [ "$n" -eq 3 ]; }\nretry_apple flaky\ntest "$n" -eq 3')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr.count('retry '), 2)

    def test_final_failure_is_not_accepted(self):
        result = self.run_shell('bad() { return 68; }\nretry_apple bad')
        self.assertEqual(result.returncode, 68)
        self.assertEqual(result.stderr.count('retry '), 2)
