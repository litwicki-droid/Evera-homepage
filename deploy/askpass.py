#!/usr/bin/env python3
"""OpenSSH calls this helper; never print the password anywhere else."""
import os
import sys
if len(sys.argv) != 2 or 'password' not in sys.argv[1].lower():
    sys.exit(1)
sys.stdout.write(os.environ['SFTP_PASSWORD'] + '\n')
