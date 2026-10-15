#!/usr/bin/env python3
"""Owner-run only: hidden terminal input, anonymous stdin pipe, filtered output."""
import getpass
import pathlib
import re
import subprocess
import sys
key = getpass.getpass('Paste the sandbox restricted key (hidden), then press Enter: ')
if not re.fullmatch(r'rk_test_[A-Za-z0-9]+', key):
    sys.exit('A sandbox restricted key is required. Nothing was run.')
script = pathlib.Path(__file__).with_name('checkout-sandbox-acceptance.mjs')
result = subprocess.run(['node', str(script)], input=key, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
key = None
# Never forward provider errors, assertion objects, environment, URLs or raw TAP.
for line in result.stdout.splitlines():
    if re.fullmatch(r'(?:# )?PASS [A-Za-z0-9 ,.+-]+', line):
        print(line.removeprefix('# '))
print('Sandbox acceptance passed.' if result.returncode == 0 else 'Sandbox acceptance failed. Raw output was discarded to protect credentials.')
sys.exit(result.returncode)
