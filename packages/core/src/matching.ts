import { hash } from './config.js';
import type { InstructionUnit, Match } from './types.js';
export function lexicalTerms(text:string): Set<string> {return new Set(text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []);}
export function similarity(a:string,b:string):number {const x=lexicalTerms(a),y=lexicalTerms(b); const common=[...x].filter(t=>y.has(t)).length; return 2*common/(x.size+y.size || 1);}
export function matchUnits(before:InstructionUnit[],after:InstructionUnit[]):Match[] {
  const remainingBefore=new Set(before.filter(u=>u.sourceRole!=='example'));const remainingAfter=new Set(after.filter(u=>u.sourceRole!=='example')); const matches:Match[]=[];
  const pair=(a:InstructionUnit,b:InstructionUnit,score=1)=>{
    remainingBefore.delete(a);remainingAfter.delete(b);
    const exact=a.contentFingerprint===b.contentFingerprint && a.contextFingerprint===b.contextFingerprint;
    matches.push({kind:exact ? (a.span.path!==b.span.path || a.span.startOffset!==b.span.startOffset ? 'moved':'unchanged') : 'changed',before:[a],after:[b],score});
  };
  for(const a of [...remainingBefore]) if(a.authorId) {const candidates=[...remainingAfter].filter(b=>a.authorId===b.authorId);const others=[...remainingBefore].filter(b=>b.authorId===a.authorId); if(candidates.length===1 && others.length===1) pair(a,candidates[0]!);}
  for(const a of [...remainingBefore]) {
    const candidates=[...remainingAfter].filter(b=>a.contentFingerprint===b.contentFingerprint);
    const local=candidates.filter(b=>b.span.path===a.span.path && hash(b.headingPath)===hash(a.headingPath));
    const others=[...remainingBefore].filter(b=>b.contentFingerprint===a.contentFingerprint);
    if(local.length===1) pair(a,local[0]!); else if(candidates.length===1 && others.length===1)pair(a,candidates[0]!);
  }
  const score=(a:InstructionUnit,b:InstructionUnit):number=>0.7*similarity(a.text,b.text)+0.2*similarity(a.headingPath.join(' '),b.headingPath.join(' '))+0.1*Number(a.span.path===b.span.path);
  for(const a of [...remainingBefore]) {
    if(!remainingBefore.has(a))continue;
    const ranked=[...remainingAfter].map(b=>({b,score:score(a,b)})).filter(b=>b.score>=0.48).sort((x,y)=>y.score-x.score || x.b.unitId.localeCompare(y.b.unitId));
    if(!ranked.length)continue;
    const best=ranked[0]!;
    const reverse=[...remainingBefore].map(b=>({b,score:score(b,best.b)})).sort((x,y)=>y.score-x.score);
    if((ranked[1] && best.score-ranked[1].score<0.12) || (reverse[1] && reverse[0]!.score-reverse[1].score<0.12)) {
      const tied=ranked.filter(r=>best.score-r.score<0.12).map(r=>r.b);
      const groupBefore=[...remainingBefore].filter(b=>tied.some(c=>score(b,c)>=best.score-0.12));
      matches.push({kind:'ambiguous',before:groupBefore,after:tied,score:best.score});groupBefore.forEach(b=>remainingBefore.delete(b));tied.forEach(b=>remainingAfter.delete(b));
    } else if(reverse[0]?.b===a) pair(a,best.b,best.score);
  }
  for(const a of remainingBefore)matches.push({kind:'removed',before:[a],after:[]});
  for(const b of remainingAfter)matches.push({kind:'added',before:[],after:[b]});
  return matches;
}
