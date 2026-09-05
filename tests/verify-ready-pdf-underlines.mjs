import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const run=spawnSync('python3',['tools/ready-pdf-underlines.py','--self-test'],{encoding:'utf8'});
assert.equal(run.status,0,run.stderr||run.stdout);
assert.match(run.stdout,/underline glyph intersection verified/);
console.log('READY publisher underline geometry extraction verified.');
