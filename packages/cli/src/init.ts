import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_CONFIG } from '@skillcheck/core';
import SKILL_TEXT from '../assets/skillcheck/SKILL.md';
export async function safeWrite(root:string,relative:string,content:string,overwrite=false):Promise<'created'|'kept'> {
  const boundary=await realpath(root);const destination=path.resolve(boundary,relative);
  if(!destination.startsWith(boundary+path.sep))throw new Error(`Installation path leaves repository: ${relative}.`);
  let parent=path.dirname(destination);while(parent!==boundary){try{const stat=await lstat(parent);if(stat.isSymbolicLink())throw new Error(`Installation cannot traverse a symlink: ${relative}.`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}parent=path.dirname(parent);}
  try{const stat=await lstat(destination);if(stat.isSymbolicLink())throw new Error(`Installation target is a symlink: ${relative}.`);if(!overwrite)return 'kept';}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,content,{flag:overwrite?'w':'wx'});return 'created';
}
export function workflow(tool='.skillcheck/tool/skillcheck.mjs'):string {
  return `name: Skillcheck\non:\n  pull_request:\n  push:\n    branches: [main, master]\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  instructions:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\n        with:\n          fetch-depth: 0\n          persist-credentials: false\n      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7\n        with:\n          node-version: '22'\n          package-manager-cache: false\n      - name: Check instructions\n        id: check\n        shell: bash\n        env:\n          BASE_SHA: \${{ github.event.pull_request.base.sha }}\n          HEAD_SHA: \${{ github.event.pull_request.head.sha }}\n        run: |\n          mkdir -p .skillcheck/reports\n          status=0\n          if [ -n "$BASE_SHA" ]; then\n            node ${tool} diff --base "$BASE_SHA" --head "$HEAD_SHA" --merge-base --deterministic --format json --output .skillcheck/reports/report.json || status=$?\n          else\n            node ${tool} scan --deterministic --format json --output .skillcheck/reports/report.json || status=$?\n          fi\n          node ${tool} report --input .skillcheck/reports/report.json --format markdown --output .skillcheck/reports/report.md\n          cat .skillcheck/reports/report.md >> "$GITHUB_STEP_SUMMARY"\n          echo "exit_code=$status" >> "$GITHUB_OUTPUT"\n      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7\n        if: always()\n        with:\n          name: skillcheck-report\n          include-hidden-files: true\n          if-no-files-found: error\n          path: .skillcheck/reports/\n      - name: Apply result\n        if: steps.check.outputs.exit_code != '0'\n        env:\n          SKILLCHECK_EXIT: \${{ steps.check.outputs.exit_code }}\n        run: exit "$SKILLCHECK_EXIT"\n`;
}
export async function initialize(root:string,options:{ci:boolean;skillDirectory:string|false;force:boolean}):Promise<string[]> {
  const messages:string[]=[];
  const config={version:1,include:['**/SKILL.md'],exclude:[],compositions:[],provider:DEFAULT_CONFIG.provider,semantic:{enabled:false},ci:DEFAULT_CONFIG.ci};
  messages.push(`${await safeWrite(root,'skillcheck.config.json',JSON.stringify(config,null,2)+'\n')} skillcheck.config.json`);
  const executable=await readFile(fileURLToPath(import.meta.url),'utf8');
  messages.push(`${await safeWrite(root,'.skillcheck/tool/skillcheck.mjs',executable,options.force)} .skillcheck/tool/skillcheck.mjs`);
  try {const notices=await readFile(new URL('./THIRD_PARTY_NOTICES.txt',import.meta.url),'utf8');messages.push(`${await safeWrite(root,'.skillcheck/tool/THIRD_PARTY_NOTICES.txt',notices,options.force)} .skillcheck/tool/THIRD_PARTY_NOTICES.txt`);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(options.skillDirectory!==false) {
    const skill=SKILL_TEXT;
    messages.push(`${await safeWrite(root,path.posix.join(options.skillDirectory,'skillcheck','SKILL.md'),skill,options.force)} ${options.skillDirectory}/skillcheck/SKILL.md`);
  }
  if(options.ci)messages.push(`${await safeWrite(root,'.github/workflows/skillcheck.yml',workflow(),options.force)} .github/workflows/skillcheck.yml`);
  messages.push('Run: node .skillcheck/tool/skillcheck.mjs scan');
  messages.push('Each discovered skill has an independent scope. Configure compositions to compare instructions across files.');
  return messages;
}
