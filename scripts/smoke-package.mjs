import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const exec=promisify(execFile),directory=await mkdtemp(path.join(tmpdir(),'skillcheck-package-'));
try {
  const archive=path.resolve('artifacts/skillcheck-cli-0.1.0.tgz'),prefix=path.join(directory,'install');
  await exec('npm',['install','--prefix',prefix,archive,'--ignore-scripts','--no-audit','--no-fund']);
  const binary=path.join(prefix,'node_modules/@skillcheck/cli/dist/skillcheck.mjs');
  const repo=path.join(directory,'repo with spaces 🐈');await mkdir(path.join(repo,'.claude/skills/example'),{recursive:true});
  await writeFile(path.join(repo,'.claude/skills/example/SKILL.md'),'---\nname: example\ndescription: Package smoke fixture.\n---\n\nAlways preserve source evidence.\n');
  await exec(process.execPath,[binary,'init','--root',repo,'--ci','--skill-directory','.claude/skills']);
  const {stdout}=await exec(process.execPath,[path.join(repo,'.skillcheck/tool/skillcheck.mjs'),'scan','--format','json'],{cwd:repo});
  const report=JSON.parse(stdout);assert.equal(report.exitCode,0);assert.equal(report.coverage.mode,'deterministic');assert.ok(report.units.some(u=>u.span.path==='.claude/skills/example/SKILL.md'));
  assert.ok((await readFile(path.join(repo,'.github/workflows/skillcheck.yml'),'utf8')).includes('contents: read'));
  console.log('Packaged install, hidden skill discovery, portable init and standalone scan passed in a repository with spaces and Unicode.');
} finally {await rm(directory,{recursive:true,force:true});}
