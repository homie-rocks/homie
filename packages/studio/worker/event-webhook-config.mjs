export const webhookName=name=>'@webhook/'+name;
export const webhookSecret=name=>'STUDIO_EVENT_WEBHOOK_'+Array.from(new TextEncoder().encode(name),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
export function validateWebhook(name,hook) {
  if(!/^[a-z][a-z0-9-]*$/.test(name))throw new Error('Invalid event feed name');
  let url;try{url=new URL(hook.url);}catch{throw new Error('Webhook requires an HTTPS URL');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Webhook requires HTTPS without credentials or a fragment');
  if(hook.secret!==webhookSecret(name))throw new Error('Use events webhook add to provision this feed’s signing secret');
}
