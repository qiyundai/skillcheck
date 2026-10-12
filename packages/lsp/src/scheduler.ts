/** One revision owns publication. Cancellation is best effort; stale results are always discarded. */
export class RevisionScheduler {
  private revision=0;private controller=new AbortController();private timer:ReturnType<typeof setTimeout>|undefined;
  invalidate():{revision:number;signal:AbortSignal}{this.revision++;this.controller.abort();this.controller=new AbortController();if(this.timer)clearTimeout(this.timer);return {revision:this.revision,signal:this.controller.signal};}
  current(revision:number):boolean{return revision===this.revision && !this.controller.signal.aborted;}
  schedule(revision:number,run:()=>Promise<void>,delayMs=800):void{if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{if(this.current(revision))void run();},delayMs);}
  dispose():void{this.invalidate();}
}
