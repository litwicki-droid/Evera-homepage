import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import publish as p

class Fake:
    def __init__(self):
        self.tree = {'/':{'www':'d'}, '/www':{}}
        self.commands = []
    def listing(self, path): return dict(self.tree[path])
    ensure_dir = p.SFTP.ensure_dir
    validate_files = p.SFTP.validate_files
    def run(self, commands):
        import shlex
        for command in commands:
            self.commands.append(command)
            cmd, *args = shlex.split(command)
            if cmd == 'mkdir':
                parent, name = args[0].rsplit('/',1)
                self.tree[parent or '/'][name] = 'd'
                self.tree[args[0]] = {}
            elif cmd == 'put':
                parent, name = args[1].rsplit('/',1)
                self.tree[parent][name] = '-'
            elif cmd == 'rename':
                parent, name = args[0].rsplit('/',1)
                self.tree[parent][args[1].rsplit('/',1)[1]] = self.tree[parent].pop(name)
            else: raise AssertionError(command)
        return ''

class Tests(unittest.TestCase):
    def test_manifest_and_index_last(self):
        files = p.load_manifest()
        self.assertEqual(len(files),22)
        self.assertEqual(files[-1],'index.html')
        self.assertNotIn('README.md',files)
    def test_unsafe_remote_paths(self):
        for path in ('','/','www','/www/','/www/../secret','/www/./x','/www//x','/www/a b','/www/*','/www/$(x)'):
            with self.subTest(path=path), self.assertRaises(p.DeployError): p.components(path)
    def test_numeric_listing(self):
        result = p.parse_listing('sftp> ls -lan "/www"\n' +
            'drwxr-xr-x    2 1000 1000 4096 Nov  2 12:30 assets\n' +
            '-rw-r--r--    1 1000 1000 100 Nov  2 2026 index.html\n' +
            'lrwxrwxrwx    1 1000 1000 4 Nov  2 2026 linked -> /etc\n')
        self.assertEqual(result, {'assets':'d','index.html':'-','linked':'l'})
        with self.assertRaises(p.DeployError): p.parse_listing('unexpected output')
    def test_check_is_read_only(self):
        fake = Fake(); fake.ensure_dir('/www'); fake.validate_files('/www',p.load_manifest())
        self.assertEqual(fake.commands,[])
    def test_symlink_directory_and_file_rejected(self):
        for name in ('assets','index.html'):
            fake = Fake(); fake.tree['/www'][name]='l'
            with self.assertRaises(p.DeployError): fake.validate_files('/www',p.load_manifest())
            self.assertEqual(fake.commands,[])
        fake=Fake(); fake.tree['/']['www']='l'
        with self.assertRaises(p.DeployError): fake.ensure_dir('/www')
    def test_upload_only_manifest_and_preserve_others(self):
        fake=Fake(); fake.tree['/www']['unrelated.txt']='-'
        fake.tree['/www']['other-link']='l'
        p.publish(fake,'/www',p.load_manifest())
        puts=[c for c in fake.commands if c.startswith('put ')]
        renames=[c for c in fake.commands if c.startswith('rename ')]
        self.assertEqual(len(puts),22); self.assertEqual(len(renames),22)
        self.assertTrue(renames[-1].endswith('/index.html"'))
        self.assertEqual(fake.tree['/www']['unrelated.txt'],'-')
        self.assertEqual(fake.tree['/www']['other-link'],'l')
        self.assertFalse(any(name.startswith('.evera-upload-') for entries in fake.tree.values() for name in entries))
        self.assertFalse(any(c.startswith(('rm ','rmdir ','!','ssh ')) for c in fake.commands))
    def test_local_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); (root/'deploy').mkdir()
            files=['index.html']+['f'+str(i) for i in range(19)]
            (root/'deploy/manifest.json').write_text(json.dumps({'files':files}))
            for name in files: (root/name).write_text('x')
            (root/'f0').unlink(); (root/'f0').symlink_to(root/'index.html')
            with self.assertRaises(p.DeployError): p.load_manifest(root)
    def test_subprocess_security_and_timeout(self):
        env={'SFTP_HOST':'sftp.example.test','SFTP_USER':'evera','SFTP_PASSWORD':'test-only-secret',
             'SFTP_KNOWN_HOSTS':'sftp.example.test ssh-ed25519 AAAA-test-placeholder'}
        with tempfile.TemporaryDirectory() as d, patch.dict(os.environ,env):
            client=p.SFTP(d)
            self.assertNotIn(env['SFTP_PASSWORD'],' '.join(client.cmd))
            self.assertIn('-oStrictHostKeyChecking=yes',client.cmd)
            self.assertEqual(client.env['SSH_ASKPASS_REQUIRE'],'force')
            self.assertEqual(Path(client.env['SSH_ASKPASS']).stat().st_mode & 0o777,0o700)
            with patch('publish.subprocess.run',side_effect=subprocess.TimeoutExpired('sftp',120)):
                with self.assertRaisesRegex(p.DeployError,'120 sekunder'): client.run(['ls -lan "/"'])
            with patch('publish.subprocess.run',return_value=subprocess.CompletedProcess([],1,'','test-only-secret')):
                with self.assertRaises(p.DeployError) as error: client.run(['ls -lan "/"'])
                self.assertNotIn('test-only-secret',str(error.exception))
    def test_production_gate(self):
        with patch('sys.argv',['publish.py','--mode','production']), patch.dict(os.environ,{},clear=True):
            with self.assertRaisesRegex(p.DeployError,'spärrad'): p.main()
    def test_askpass_only_password_prompt(self):
        env=dict(os.environ,SFTP_PASSWORD='unit-test-value')
        script=str(p.ROOT/'deploy/askpass.py')
        result=subprocess.run(['python3',script,'Password:'],env=env,capture_output=True,text=True)
        self.assertEqual(result.stdout,'unit-test-value\n')
        denied=subprocess.run(['python3',script,'Host authenticity?'],env=env,capture_output=True,text=True)
        self.assertNotEqual(denied.returncode,0); self.assertEqual(denied.stdout,'')

if __name__ == '__main__': unittest.main()

class OneComFormat(unittest.TestCase):
    def test_unknown_link_count(self):
        self.assertEqual(p.parse_listing("drwxr-xr-x ? 0 0 4096 Nov 02 14:00 /."), {"/.": "d"})
