import {catalogue} from './catalogue.mjs';
/** Durable rows remain the source of truth. Messages carry wakeups, never records. */
export async function enqueueChanges(env, origin) {
  if(env.BACKGROUND) return env.BACKGROUND.send({v:1,type:'studio.changed',origin});
  // Older wrappers and local unit fixtures without the binding keep their behavior.
  return (await import('./functions.mjs')).runFunctions(env,()=>catalogue(env,origin),origin);
}
export async function consumeBackground(batch, env) {
  const changes=batch.messages.filter(m=>m.body?.v===1&&m.body.type==='studio.changed');
  if(changes.length) {
    try {
      const origin=changes[0].body.origin;
      await (await import('./functions.mjs')).runFunctions(env,()=>catalogue(env,origin),origin);
      for(const message of changes)message.ack();
    } catch(error) {
      console.error('Background delivery failed',error);
      for(const message of changes)message.retry({delaySeconds:30});
    }
  }
  for(const message of batch.messages)if(!changes.includes(message)) {
    try {
      if(message.body?.v!==1||message.body.type!=='stripe.event')throw new Error('Unknown background message type');
      await (await import('./stripe-intake.mjs')).reconcileStripeEvent(env,message.body.id,await catalogue(env));
      message.ack();
    } catch(error) {console.error('Stripe queue delivery failed',error);message.retry({delaySeconds:30});}
  }
}
