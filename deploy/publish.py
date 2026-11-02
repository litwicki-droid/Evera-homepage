#!/usr/bin/env python3
"""Exactly 20 static files, SFTP subsystem only, no remote shell commands."""
import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent.parent
SAFE = re.compile(r'[A-Za-z0-9_.-]+\Z')

class DeployError(Exception):
    pass

def fail(message):
    raise DeployError(message)

def components(path):
    if not path.startswith('/') or path == '/' or path.endswith('/'):
        fail('SFTP_REMOTE_DIR måste vara en verifierad absolut undermapp, utan avslutande /.')
    parts = path[1:].split('/')
    if any(not SAFE.fullmatch(p) or p in ('.', '..') or p.startswith('-') for p in parts):
        fail('Fjärrsökvägen innehåller otillåtna tecken eller komponenter.')
    return parts

def load_manifest(root=ROOT):
    files = json.loads((root / 'deploy/manifest.json').read_text())['files']
    if len(files) != 20 or len(set(files)) != 20 or 'index.html' not in files:
        fail('Manifestet måste innehålla exakt 20 unika filer inklusive index.html.')
    for name in files:
        parts = name.split('/')
        if name.startswith('/') or any(not SAFE.fullmatch(p) or p in ('.','..') or p.startswith('-') for p in parts):
            fail('Ogiltig sökväg i manifestet.')
        path = root
        for part in parts:
            path = path / part
            if path.is_symlink():
                fail('Lokala symboliska länkar tillåts inte: ' + name)
        if not path.is_file():
            fail('Manifestfil saknas: ' + name)
    return sorted(files, key=lambda p: (p == 'index.html', p))

def parse_listing(output):
    entries = {}
    for line in output.splitlines():
        line = line.strip()
        if not line or line.startswith('sftp> ') or line.startswith('Connected to ') or re.fullmatch(r'total \d+', line):
            continue
        # OpenSSH ls -lan: permissions, links, numeric uid/gid, size, date, name.
        m = re.fullmatch(r'([dl-])[rwxstST-]{9}[+@.]?\s+(?:\d+|\?)\s+\d+\s+\d+\s+\d+\s+\S+\s+\S+\s+\S+\s+(.+)', line)
        if not m:
            fail('Okänt SFTP-listformat. Inga fler ändringar görs.')
        kind, name = m.groups()
        if kind == 'l':
            name = name.split(' -> ', 1)[0]
        if name in entries:
            fail('Tvetydig fjärrlistning.')
        entries[name] = kind
    return entries

class SFTP:
    def __init__(self, temp):
        self.host = os.environ.get('SFTP_HOST', '')
        self.user = os.environ.get('SFTP_USER', '')
        self.port = os.environ.get('SFTP_PORT', '22')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]*', self.host):
            fail('SFTP_HOST saknas eller har otillåtet format.')
        if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@-]*', self.user):
            fail('SFTP_USER saknas eller har otillåtet format.')
        if not self.port.isdigit() or not 1 <= int(self.port) <= 65535:
            fail('SFTP_PORT måste vara 1–65535.')
        password = os.environ.get('SFTP_PASSWORD', '')
        if not password or '\n' in password or '\r' in password:
            fail('SFTP_PASSWORD saknas eller innehåller radbrytning.')
        known = os.environ.get('SFTP_KNOWN_HOSTS', '')
        if not known.strip():
            fail('SFTP_KNOWN_HOSTS saknas. Hämta betrodd värdnyckel separat.')
        known_path = Path(temp) / 'known_hosts'
        known_path.write_text(known + '\n')
        known_path.chmod(0o600)
        helper = Path(temp) / 'askpass'
        shutil.copyfile(ROOT / 'deploy/askpass.py', helper)
        helper.chmod(0o700)
        self.env = os.environ.copy()
        self.env.update(SSH_ASKPASS=str(helper), SSH_ASKPASS_REQUIRE='force', DISPLAY='evera:0', LC_ALL='C')
        self.cmd = ['sftp', '-F', '/dev/null', '-q', '-P', self.port,
            '-oBatchMode=no', '-oStrictHostKeyChecking=yes',
            '-oUserKnownHostsFile=' + str(known_path), '-oGlobalKnownHostsFile=/dev/null',
            '-oUpdateHostKeys=no', '-oVerifyHostKeyDNS=no',
            '-oPreferredAuthentications=password', '-oPubkeyAuthentication=no',
            '-oNumberOfPasswordPrompts=1', '-oConnectTimeout=20',
            '-oServerAliveInterval=15', '-oServerAliveCountMax=2',
            '-b', '-', self.user + '@' + self.host]

    def run(self, commands):
        try:
            result = subprocess.run(self.cmd, input='\n'.join(commands)+'\n',
                text=True, capture_output=True, env=self.env, start_new_session=True, timeout=120)
        except FileNotFoundError:
            fail('OpenSSH sftp hittades inte. Installera OpenSSH-klienten innan körning.')
        except subprocess.TimeoutExpired:
            fail('SFTP tog mer än 120 sekunder. En del filer kan redan ha publicerats; kontrollera innan nytt försök.')
        if result.returncode:
            # Never relay raw client/server output; it may contain sensitive data.
            fail('SFTP misslyckades. Kontrollera värdnyckel, inloggning, sökväg och behörighet. Ingen rå serverlogg visas. En skrivning kan ha hunnit ske.')
        return result.stdout

    def listing(self, path):
        entries = parse_listing(self.run(['ls -lan "'+path+'"']))
        prefix = path.rstrip('/') + '/'
        normalized = {}
        for name, kind in entries.items():
            if name.startswith(prefix):
                name = name[len(prefix):]
            if '/' in name or name in normalized:
                fail('Tvetydig sökväg i fjärrlistningen.')
            normalized[name] = kind
        return normalized

    def ensure_dir(self, path, create=False):
        current = '/'
        for part in components(path):
            entries = self.listing(current)
            kind = entries.get(part)
            target = current.rstrip('/') + '/' + part
            if kind is None and create:
                self.run(['mkdir "'+target+'"'])
                kind = self.listing(current).get(part)
            if kind != 'd':
                fail('Fjärrmapp saknas, är en länk eller har fel typ: ' + target)
            current = target

    def validate_files(self, target, files):
        # Read-only preflight; inspect every existing ancestor and destination.
        for name in files:
            parts = name.split('/')
            current = target
            missing = False
            for i, part in enumerate(parts):
                if missing:
                    continue
                kind = self.listing(current).get(part)
                if kind is None:
                    missing = True
                elif kind != ('-' if i == len(parts)-1 else 'd'):
                    fail('Skyddad fjärrsökväg (länk eller fel filtyp): ' + name)
                current += '/' + part

def publish(client, target, files, source=ROOT):
    client.ensure_dir(target)
    client.validate_files(target, files)
    token = uuid.uuid4().hex
    for name in files:
        parent, _, basename = name.rpartition('/')
        directory = target + ('/' + parent if parent else '')
        client.ensure_dir(directory, create=True)
        entries = client.listing(directory)
        if basename in entries and entries[basename] != '-':
            fail('Målfilen har ändrat typ. Avbryter.')
        tempname = '.evera-upload-' + token + '-' + basename
        if tempname in entries:
            fail('Tillfällig fjärrfil finns redan. Avbryter.')
        remote = directory + '/' + basename
        temporary = directory + '/' + tempname
        # Local path is staged under a generated, simple directory.
        client.run(['put "'+str(source / name)+'" "'+temporary+'"'])
        # Check again immediately before rename; no delete fallback.
        client.ensure_dir(directory)
        entries = client.listing(directory)
        if entries.get(tempname) != '-' or (basename in entries and entries[basename] != '-'):
            fail('Fjärrfilens typ ändrades före namnbyte.')
        client.run(['rename "'+temporary+'" "'+remote+'"'])

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['discover','check','preview','production'], default='check')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    files = load_manifest()
    if args.dry_run:
        print('Lokal kontroll OK: exakt 20 ordinarie filer. index.html publiceras sist. Ingen nätverksanslutning.')
        return
    if args.mode == 'production':
        if os.environ.get('PRODUCTION_ENABLED') != 'true' or os.environ.get('CONFIRM_PRODUCTION') != 'PUBLISH evera.care':
            fail('Produktion är spärrad: aktivera repo-variabeln och skriv exakt PUBLISH evera.care.')
        if os.environ.get('GITHUB_REF') != 'refs/heads/main':
            fail('Produktion måste köras från main.')
    if args.mode == 'discover':
        with tempfile.TemporaryDirectory(prefix='evera-discover-') as temp:
            client = SFTP(temp)
            entries = client.listing('/')
            print('SFTP discovery, read-only. Root entries:')
            for name, kind in sorted(entries.items()):
                print(kind + ' ' + name)
            resolved = client.run(['pwd'])
            match = re.search(r'^Remote working directory: (/.+)$', resolved, re.MULTILINE)
            if not match:
                fail('Kan inte fastställa kanonisk webbrot från SFTP pwd.')
            canonical = match.group(1).strip()
            components(canonical)
            client.ensure_dir(canonical)
            print('Verified account starting directory: ' + canonical)
            print('Canonical root entries:')
            for name, kind in sorted(client.listing(canonical).items()):
                print(kind + ' ' + name)
            import hashlib
            destination = str(Path(temp) / 'remote-index.html')
            client.run(['get "' + canonical + '/index.html" "' + destination + '"'])
            digest = hashlib.sha256(Path(destination).read_bytes()).hexdigest()
            if digest != '4e97109ce116fe99b897fca0f0d5871c522800998a32ee3df1a6413534b27b81':
                fail('Startsidan i SFTP-mappen matchar inte den privata säkerhetskopian. Stoppar för granskning.')
            print('Remote index SHA256 matches private File Manager backup: ' + digest)
        return
    remote = os.environ.get('SFTP_REMOTE_DIR', '')
    components(remote)
    with tempfile.TemporaryDirectory(prefix='evera-deploy-') as temp:
        client = SFTP(temp)
        client.ensure_dir(remote)
        if args.mode == 'check':
            client.validate_files(remote, files)
            print('SFTP-kontroll OK. Inga fjärrfiler eller mappar ändrades. Skrivbehörighet har inte testats.')
            return
        target = remote
        if args.mode == 'preview':
            target += '/evera-preview-' + uuid.uuid4().hex
            # Unique folder must not exist, even as a symlink.
            if target.rsplit('/',1)[1] in client.listing(remote):
                fail('Preview-mappen finns redan.')
            client.run(['mkdir "'+target+'"'])
        staging = Path(temp) / 'site'
        staging.mkdir()
        for name in files:
            destination = staging / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, destination)
        publish(client, target, files, staging)
        print('Publicering klar: 20 filer. Mål: ' + target)

if __name__ == '__main__':
    try:
        main()
    except (DeployError, ValueError, KeyError, OSError) as exc:
        # Generic OS/JSON exceptions can contain sensitive paths; suppress details.
        print('Fel: ' + (str(exc) if isinstance(exc, DeployError) else 'Lokal fil- eller konfigurationskontroll misslyckades.'), file=sys.stderr)
        sys.exit(1)
